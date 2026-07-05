#include "lammpsweb.h"

#include "atom.h"
#include "domain.h"
#include "fix_js_async.h"
#include "fix_wall.h"
#include "force.h"
#include "info.h"
#include "input.h"
#include "library.h"
#include "lmptype.h"
#include "modify.h"
#include "neigh_list.h"
#include "update.h"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#include <emscripten.h>

// Throws a real JS Error (propagates through the wasm frames to the embind
// caller; under ASYNCIFY a suspended call's promise rejects with it).
EM_JS(void, lammpsweb_throw_error, (const char *message), {
  throw new Error(UTF8ToString(message));
});

namespace {

inline std::string buildRunCommand(std::int32_t steps, bool applyPre, bool applyPost) {
  std::string command = "run ";
  command += std::to_string(steps);
  command += applyPre ? " pre yes" : " pre no";
  command += applyPost ? " post yes" : " post no";
  command.push_back('\n');
  return command;
}

inline LAMMPSWeb::ScalarType scalarForTagint() noexcept {
  using LAMMPS_NS::tagint;
  if (sizeof(tagint) == sizeof(std::int64_t)) {
    return LAMMPSWeb::ScalarType::Int64;
  }
  return LAMMPSWeb::ScalarType::Int32;
}

template <typename DomainT>
auto invokeMinimumImage(DomainT* domain, double &dx, double &dy, double &dz, int)
    -> decltype(domain->minimum_image(dx, dy, dz), (void)0) {
  domain->minimum_image(dx, dy, dz);
}

template <typename DomainT>
auto invokeMinimumImage(DomainT* domain, double &dx, double &dy, double &dz, long)
    -> decltype(domain->minimum_image("LAMMPSWeb", 0, dx, dy, dz), (void)0) {
  domain->minimum_image("LAMMPSWeb", 0, dx, dy, dz);
}

inline void applyMinimumImage(LAMMPS_NS::Domain* domain, double &dx, double &dy, double &dz) {
  invokeMinimumImage(domain, dx, dy, dz, 0);
}

}  // namespace

namespace LAMMPSWebAsync {
namespace {
emscripten::val g_step_callback = emscripten::val::undefined();
emscripten::val g_promise_waiter = emscripten::val::undefined();
constexpr int kAsyncSleepMs = 1;
}  // namespace

void setStepCallback(emscripten::val callback) {
  g_step_callback = callback;
}

void setPromiseWaiter(emscripten::val waiter) {
  g_promise_waiter = waiter;
}

bool invokeStepCallbackAndWait(std::int32_t step) {
  if (g_step_callback.isUndefined() || g_step_callback.isNull()) {
    return true;
  }
  if (g_step_callback.typeOf().as<std::string>() != "function") {
    return true;
  }

  emscripten::val result = g_step_callback(emscripten::val(step));
  if (result.isUndefined() || result.isNull()) {
    return true;
  }

  emscripten::val then = result["then"];
  if (then.isUndefined() || then.typeOf().as<std::string>() != "function") {
    return true;
  }
  if (g_promise_waiter.isUndefined() || g_promise_waiter.isNull()) {
    return true;
  }

  int done = 0;
  int failed = 0;
  // Pass addresses as doubles so they arrive as plain JS numbers in both
  // wasm32 and MEMORY64 builds (uintptr_t would marshal as BigInt there).
  g_promise_waiter(result,
                   emscripten::val(static_cast<double>(reinterpret_cast<std::uintptr_t>(&done))),
                   emscripten::val(static_cast<double>(reinterpret_cast<std::uintptr_t>(&failed))));
  while (!done) {
    emscripten_sleep(kAsyncSleepMs);
  }

  return failed == 0;
}
}  // namespace LAMMPSWebAsync

void LAMMPSWeb::destroyLammps(LAMMPS_NS::LAMMPS *ptr) noexcept {
  if (ptr) {
    lammps_close(static_cast<void *>(ptr));
  }
}

LAMMPSWeb::LAMMPSWeb() = default;

LAMMPSWeb::~LAMMPSWeb() {
  stop();
}

void LAMMPSWeb::start() {
  startWithArgs({});
}

void LAMMPSWeb::startWithArgs(const std::vector<std::string> &extraArgs) {
  if (hasSimulation()) {
    stop();
  }

  // lammps_open_no_mpi expects a full argv, including the program name.
  std::vector<std::string> args;
  args.reserve(extraArgs.size() + 1);
  args.emplace_back("lammps.js");
  args.insert(args.end(), extraArgs.begin(), extraArgs.end());

  std::vector<char *> argv;
  argv.reserve(args.size());
  for (auto &arg : args) {
    argv.push_back(arg.data());
  }

  auto *instance = static_cast<LAMMPS_NS::LAMMPS *>(
    lammps_open_no_mpi(static_cast<int>(argv.size()), argv.data(), nullptr)
  );

  if (!instance) {
    throw std::runtime_error("Failed to open LAMMPS instance");
  }

  m_lmp.reset(instance);
  m_lastErrorMessage.clear();
  m_lastErrorInputLine.clear();
}

void LAMMPSWeb::stop() {
  if (!hasSimulation()) {
    return;
  }

  m_modifiers.clear();
  m_lmp.reset();
  resetStaticBuffers();
}

void LAMMPSWeb::advance(std::int32_t steps, bool applyPre, bool applyPost) {
  auto *sim = raw();
  if (!sim || steps <= 0) {
    return;
  }

  const std::string command = buildRunCommand(steps, applyPre, applyPost);
  lammps_commands_string(static_cast<void *>(sim), command.c_str());
  throwIfLammpsError();
}

std::string LAMMPSWeb::getLastInputLine() const {
  const auto *sim = raw();
  if (!sim || !sim->input) {
    return "";
  }
  const char *line = sim->input->get_last_line();
  return line ? std::string(line) : "";
}

void LAMMPSWeb::throwIfLammpsError() {
  auto *sim = raw();
  if (!sim || lammps_has_error(static_cast<void *>(sim)) == 0) {
    return;
  }
  // Reading the message clears the library's error slot; keep copies so
  // getLastErrorMessage/getLastErrorInputLine still answer afterwards.
  char buffer[4096];
  lammps_get_last_error_message(static_cast<void *>(sim), buffer, sizeof(buffer));
  m_lastErrorMessage = buffer;
  m_lastErrorInputLine = getLastInputLine();
  lammpsweb_throw_error(m_lastErrorMessage.c_str());
}

void LAMMPSWeb::runCommand(const std::string &command) {
  if (command.empty()) {
    return;
  }

  std::string script = command;
  if (script.back() != '\n') {
    script.push_back('\n');
  }
  runScript(script);
}

void LAMMPSWeb::runScript(const std::string &script) {
  auto *sim = raw();
  if (!sim || script.empty()) {
    return;
  }

  lammps_commands_string(static_cast<void *>(sim), script.c_str());
  throwIfLammpsError();
}

void LAMMPSWeb::runFile(const std::string &path) {
  auto *sim = raw();
  if (!sim || path.empty()) {
    return;
  }

  lammps_file(static_cast<void *>(sim), path.c_str());
  throwIfLammpsError();
}

void LAMMPSWeb::setAsyncStepCallback(emscripten::val callback, emscripten::val waiter) {
  LAMMPSWebAsync::setStepCallback(callback);
  LAMMPSWebAsync::setPromiseWaiter(waiter);
}

bool LAMMPSWeb::setAsyncStepFrequency(const std::string &fixId, std::int32_t every) {
  if (every <= 0) {
    return false;
  }
  auto *sim = raw();
  if (!sim || !sim->modify) {
    return false;
  }
  const int fixIndex = sim->modify->find_fix(fixId.c_str());
  if (fixIndex < 0) {
    return false;
  }
  auto *fix = dynamic_cast<LAMMPS_NS::FixJsAsync *>(sim->modify->fix[fixIndex]);
  if (!fix) {
    return false;
  }
  fix->setFrequency(every);
  return true;
}

bool LAMMPSWeb::isReady() const noexcept {
  return hasSimulation();
}

bool LAMMPSWeb::hasPackage(const std::string &name) const noexcept {
  return lammps_config_has_package(name.c_str()) != 0;
}

bool LAMMPSWeb::getIsRunning() const noexcept {
  const auto *sim = raw();
  return sim && sim->update && sim->update->whichflag != 0;
}

double LAMMPSWeb::getCurrentStep() const noexcept {
  const auto *sim = raw();
  if (!sim || !sim->update) {
    return 0;
  }
  return static_cast<double>(sim->update->ntimestep);
}

double LAMMPSWeb::getTimestepSize() const noexcept {
  const auto *sim = raw();
  if (!sim || !sim->update) {
    return 0.0;
  }
  return sim->update->dt;
}

std::int32_t LAMMPSWeb::getRunMode() const noexcept {
  const auto *sim = raw();
  if (!sim || !sim->update) {
    return 0;
  }
  return static_cast<std::int32_t>(sim->update->whichflag);
}

double LAMMPSWeb::getRunStepsDone() const noexcept {
  const auto *sim = raw();
  if (!sim || !sim->update || sim->update->whichflag == 0) {
    return 0;
  }
  return static_cast<double>(sim->update->ntimestep - sim->update->firststep);
}

double LAMMPSWeb::getRunStepsTotal() const noexcept {
  const auto *sim = raw();
  if (!sim || !sim->update || sim->update->whichflag == 0) {
    return 0;
  }
  return static_cast<double>(sim->update->laststep - sim->update->firststep);
}

double LAMMPSWeb::getThermo(const std::string &keyword) const noexcept {
  auto *sim = raw();
  if (!sim || keyword.empty()) {
    return 0.0;
  }
  const double value = lammps_get_thermo(static_cast<void *>(sim), keyword.c_str());
  // Keywords like spcpu/cpuremain raise "cannot be used between runs" when
  // idle; LAMMPS captures that into its last-error slot. Drain it here so a
  // status poll can't make the next successful run command throw a stale,
  // unrelated error.
  if (lammps_has_error(static_cast<void *>(sim))) {
    char discard[512];
    lammps_get_last_error_message(static_cast<void *>(sim), discard, sizeof(discard));
    return 0.0;
  }
  return value;
}

double LAMMPSWeb::getMemoryUsage() const noexcept {
  auto *sim = raw();
  if (!sim) {
    return 0.0;
  }
  double meminfo[3] = {0.0, 0.0, 0.0};
  LAMMPS_NS::Info info(sim);
  info.get_memory_info(meminfo);
  return meminfo[0] * 1024.0 * 1024.0;
}

double LAMMPSWeb::getComputeScalar(const std::string &id) const noexcept {
  auto *sim = raw();
  if (!sim) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  auto *value = static_cast<double *>(
    lammps_extract_compute(static_cast<void *>(sim), id.c_str(), LMP_STYLE_GLOBAL, LMP_TYPE_SCALAR)
  );
  if (!value) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  return *value;
}

EMSCRIPTEN_BINDINGS(lammps_web_module) {
  emscripten::enum_<LAMMPSWeb::ScalarType>("ScalarType")
    .value("Float32", LAMMPSWeb::ScalarType::Float32)
    .value("Float64", LAMMPSWeb::ScalarType::Float64)
    .value("Int32", LAMMPSWeb::ScalarType::Int32)
    .value("Int64", LAMMPSWeb::ScalarType::Int64);

  emscripten::value_object<LAMMPSWeb::BufferView>("BufferView")
    .field("ptr", &LAMMPSWeb::BufferView::ptr)
    .field("length", &LAMMPSWeb::BufferView::length)
    .field("components", &LAMMPSWeb::BufferView::components)
    .field("type", &LAMMPSWeb::BufferView::type);

  emscripten::value_object<LAMMPSWeb::ParticleSnapshot>("ParticleSnapshot")
    .field("positions", &LAMMPSWeb::ParticleSnapshot::positions)
    .field("ids", &LAMMPSWeb::ParticleSnapshot::ids)
    .field("types", &LAMMPSWeb::ParticleSnapshot::types)
    .field("count", &LAMMPSWeb::ParticleSnapshot::count);

  emscripten::value_object<LAMMPSWeb::BondSnapshot>("BondSnapshot")
    .field("first", &LAMMPSWeb::BondSnapshot::first)
    .field("second", &LAMMPSWeb::BondSnapshot::second)
    .field("count", &LAMMPSWeb::BondSnapshot::count);

  emscripten::value_object<LAMMPSWeb::BoxSnapshot>("BoxSnapshot")
    .field("matrix", &LAMMPSWeb::BoxSnapshot::matrix)
    .field("origin", &LAMMPSWeb::BoxSnapshot::origin)
    .field("lengths", &LAMMPSWeb::BoxSnapshot::lengths)
    .field("dimension", &LAMMPSWeb::BoxSnapshot::dimension);

  emscripten::class_<LAMMPSWeb>("LAMMPSWeb")
    .constructor<>()
    .function("start", &LAMMPSWeb::start)
    .function(
      "startWithArgs",
      emscripten::optional_override([](LAMMPSWeb &self, emscripten::val args) {
        if (args.isUndefined() || args.isNull()) {
          self.startWithArgs({});
          return;
        }
        self.startWithArgs(emscripten::vecFromJSArray<std::string>(args));
      })
    )
    .function("hasPackage", &LAMMPSWeb::hasPackage)
    .function("stop", &LAMMPSWeb::stop)
    .function(
      "advance",
      emscripten::optional_override([](LAMMPSWeb &self,
                                       std::int32_t steps,
                                       emscripten::val applyPre,
                                       emscripten::val applyPost) {
        const bool pre = applyPre.isUndefined() ? false : applyPre.as<bool>();
        const bool post = applyPost.isUndefined() ? false : applyPost.as<bool>();
        self.advance(steps, pre, post);
      })
    )
    .function("runCommand", &LAMMPSWeb::runCommand)
    .function("runScript", &LAMMPSWeb::runScript)
    .function("runFile", &LAMMPSWeb::runFile)
    .function("setAsyncStepCallback", &LAMMPSWeb::setAsyncStepCallback)
    .function("setAsyncStepFrequency", &LAMMPSWeb::setAsyncStepFrequency)
    .function("isReady", &LAMMPSWeb::isReady)
    .function("getIsRunning", &LAMMPSWeb::getIsRunning)
    .function("getLastErrorMessage", &LAMMPSWeb::getLastErrorMessage)
    .function("getLastErrorInputLine", &LAMMPSWeb::getLastErrorInputLine)
    .function("getLastInputLine", &LAMMPSWeb::getLastInputLine)
    .function("getCurrentStep", &LAMMPSWeb::getCurrentStep)
    .function("getTimestepSize", &LAMMPSWeb::getTimestepSize)
    .function("getComputeScalar", &LAMMPSWeb::getComputeScalar)
    .function("getRunMode", &LAMMPSWeb::getRunMode)
    .function("getRunStepsDone", &LAMMPSWeb::getRunStepsDone)
    .function("getRunStepsTotal", &LAMMPSWeb::getRunStepsTotal)
    .function("getThermo", &LAMMPSWeb::getThermo)
    .function("getMemoryUsage", &LAMMPSWeb::getMemoryUsage)
    .function("syncParticles", &LAMMPSWeb::syncParticles)
    .function("syncParticlesWrapped", &LAMMPSWeb::syncParticlesWrapped)
    .function("syncBonds", &LAMMPSWeb::syncBonds)
    .function("syncBondsWrapped", &LAMMPSWeb::syncBondsWrapped)
    .function("setBondDistance", &LAMMPSWeb::setBondDistance)
    .function("clearBondDistances", &LAMMPSWeb::clearBondDistances)
    .function("setBuildNeighborlist", &LAMMPSWeb::setBuildNeighborlist)
    .function("syncSimulationBox", &LAMMPSWeb::syncSimulationBox)
    .function("getWalls", &LAMMPSWeb::getWalls)
    .function("syncModifiers", &LAMMPSWeb::syncModifiers)
    .function("listModifiers", &LAMMPSWeb::listModifiers)
    .function("syncModifier", &LAMMPSWeb::syncModifier)
    .function("getModifierPerAtom", &LAMMPSWeb::getModifierPerAtom);
}

LAMMPSWeb::ParticleSnapshot LAMMPSWeb::syncParticles() {
  return captureParticles(false);
}

LAMMPSWeb::ParticleSnapshot LAMMPSWeb::syncParticlesWrapped() {
  return captureParticles(true);
}

LAMMPSWeb::BondSnapshot LAMMPSWeb::syncBonds() {
  return captureBonds(false);
}

LAMMPSWeb::BondSnapshot LAMMPSWeb::syncBondsWrapped() {
  return captureBonds(true);
}

LAMMPSWeb::ParticleSnapshot LAMMPSWeb::captureParticles(bool wrapped) {
  ParticleSnapshot snapshot{};

  auto *sim = raw();
  if (!sim || !sim->atom || !sim->domain) {
    m_particlePositions.clear();
    return snapshot;
  }

  auto *atom = sim->atom;
  const auto numAtoms = static_cast<std::uint32_t>(atom->natoms);
  if (numAtoms == 0) {
    m_particlePositions.clear();
    return snapshot;
  }

  m_particlePositions.resize(static_cast<std::size_t>(numAtoms) * 3);

  auto *domain = sim->domain;
  auto *image = wrapped ? nullptr : static_cast<int *>(lammps_extract_atom(static_cast<void *>(sim), "image"));

  for (std::uint32_t i = 0; i < numAtoms; ++i) {
    double position[3] = { atom->x[i][0], atom->x[i][1], atom->x[i][2] };
    if (image) {
      domain->unmap(position, image[i]);
    }

    const auto base = static_cast<std::size_t>(i) * 3;
    m_particlePositions[base + 0] = static_cast<float>(position[0]);
    m_particlePositions[base + 1] = static_cast<float>(position[1]);
    m_particlePositions[base + 2] = static_cast<float>(position[2]);
  }

  snapshot.count = numAtoms;
  snapshot.positions = makeView(m_particlePositions, 3, ScalarType::Float32);

  auto *ids = lammps_extract_atom(static_cast<void *>(sim), "id");
  snapshot.ids = makeRawView(ids, numAtoms, 1, scalarForTagint());

  auto *types = lammps_extract_atom(static_cast<void *>(sim), "type");
  snapshot.types = makeRawView(types, numAtoms, 1, ScalarType::Int32);

  return snapshot;
}

LAMMPSWeb::BondSnapshot LAMMPSWeb::captureBonds(bool wrapped) {
  BondSnapshot snapshot{};

  auto *sim = raw();
  if (!sim || !sim->atom || !sim->domain) {
    m_bondsPosition1.clear();
    m_bondsPosition2.clear();
    return snapshot;
  }

  auto *atom = sim->atom;
  auto *domain = sim->domain;

  m_bondsPosition1.clear();
  m_bondsPosition2.clear();

  const bool haveTopologyBonds = atom->nbonds != 0 && atom->num_bond && atom->bond_atom;
  if (!haveTopologyBonds) {
    appendNeighborlistBonds(wrapped);
    snapshot.count = static_cast<std::uint32_t>(m_bondsPosition1.size() / 3);
    snapshot.first = makeView(m_bondsPosition1, 3, ScalarType::Float32);
    snapshot.second = makeView(m_bondsPosition2, 3, ScalarType::Float32);
    return snapshot;
  }

  const auto totalBonds = static_cast<std::size_t>(atom->nbonds);
  m_bondsPosition1.reserve(totalBonds * 3);
  m_bondsPosition2.reserve(totalBonds * 3);

  auto *image = wrapped ? nullptr : static_cast<int *>(lammps_extract_atom(static_cast<void *>(sim), "image"));
  const bool shareBondAcrossRanks = sim->force && sim->force->newton_bond;

  for (int atomIndex = 0; atomIndex < atom->natoms; ++atomIndex) {
    const int bondCount = atom->num_bond[atomIndex];
    if (bondCount <= 0) {
      continue;
    }

    double first[3] = { atom->x[atomIndex][0], atom->x[atomIndex][1], atom->x[atomIndex][2] };
    if (image) {
      domain->unmap(first, image[atomIndex]);
    }

    for (int bondIndex = 0; bondIndex < bondCount; ++bondIndex) {
      const int mappedIndex = atom->map(atom->bond_atom[atomIndex][bondIndex]);
      if (mappedIndex < 0 || mappedIndex >= atom->natoms) {
        continue;
      }

      if (!shareBondAcrossRanks && atomIndex < mappedIndex) {
        continue;
      }

      double second[3] = { atom->x[mappedIndex][0], atom->x[mappedIndex][1], atom->x[mappedIndex][2] };
      if (image) {
        domain->unmap(second, image[mappedIndex]);
      }

      m_bondsPosition1.push_back(static_cast<float>(first[0]));
      m_bondsPosition1.push_back(static_cast<float>(first[1]));
      m_bondsPosition1.push_back(static_cast<float>(first[2]));

      // In wrapped mode the two endpoints can sit on opposite sides of a
      // periodic boundary; without the minimum-image correction such a bond
      // is drawn across the whole box. Unwrapped positions are continuous so
      // the correction is a no-op there (bond lengths are far below half the
      // box), which lets both modes share it.
      double dx = second[0] - first[0];
      double dy = second[1] - first[1];
      double dz = second[2] - first[2];
      applyMinimumImage(domain, dx, dy, dz);

      m_bondsPosition2.push_back(static_cast<float>(first[0] + dx));
      m_bondsPosition2.push_back(static_cast<float>(first[1] + dy));
      m_bondsPosition2.push_back(static_cast<float>(first[2] + dz));
    }
  }

  appendNeighborlistBonds(wrapped);
  snapshot.count = static_cast<std::uint32_t>(m_bondsPosition1.size() / 3);
  snapshot.first = makeView(m_bondsPosition1, 3, ScalarType::Float32);
  snapshot.second = makeView(m_bondsPosition2, 3, ScalarType::Float32);
  return snapshot;
}

LAMMPSWeb::BoxSnapshot LAMMPSWeb::syncSimulationBox() {
  BoxSnapshot snapshot{};

  auto *sim = raw();
  if (!sim || !sim->domain) {
    m_cellMatrix.fill(0.0f);
    m_boxSize.fill(0.0f);
    m_origo.fill(0.0f);
    return snapshot;
  }

  auto *domain = sim->domain;
  domain->box_corners();

  const double *origin = domain->corners[0];
  const double *a = domain->corners[1];
  const double *b = domain->corners[2];
  const double *c = domain->corners[4];

  for (int axis = 0; axis < 3; ++axis) {
    m_cellMatrix[axis] = static_cast<float>(a[axis] - origin[axis]);
    m_cellMatrix[3 + axis] = static_cast<float>(b[axis] - origin[axis]);
    m_cellMatrix[6 + axis] = static_cast<float>(c[axis] - origin[axis]);
    m_origo[axis] = static_cast<float>(origin[axis]);
    m_boxSize[axis] = static_cast<float>(domain->prd[axis]);
  }

  snapshot.matrix = makeView(m_cellMatrix, 3, ScalarType::Float32);
  snapshot.origin = makeView(m_origo, 3, ScalarType::Float32);
  snapshot.lengths = makeView(m_boxSize, 3, ScalarType::Float32);
  snapshot.dimension = static_cast<std::int32_t>(domain->dimension);
  return snapshot;
}

void LAMMPSWeb::syncModifiers() {
  auto *sim = raw();
  if (!sim) {
    m_modifiers.clear();
    return;
  }
  m_modifiers.refresh(sim);
}

emscripten::val LAMMPSWeb::listModifiers() {
  auto result = emscripten::val::array();
  for (auto *state : m_modifiers.list()) {
    auto info = emscripten::val::object();
    info.set("name", state->name);
    info.set("category", state->category);
    info.set("style", state->style);
    info.set("isPerAtom", state->isPerAtom);
    info.set("hasScalar", state->hasScalar);
    info.set("clearPerSync", state->clearPerSync);
    info.set("xLabel", state->xLabel);
    info.set("yLabel", state->yLabel);
    result.call<void>("push", info);
  }
  return result;
}

emscripten::val LAMMPSWeb::syncModifier(const std::string &category, const std::string &name) {
  auto *sim = raw();
  auto *state = m_modifiers.find(category, name);
  if (!sim || !state) {
    return emscripten::val::null();
  }
  if (!state->sync()) {
    return emscripten::val::null();
  }

  auto result = emscripten::val::object();
  result.set("name", state->name);
  result.set("category", state->category);
  result.set("style", state->style);
  result.set("isPerAtom", state->isPerAtom);
  result.set("hasScalar", state->hasScalar);
  result.set("scalar", state->scalarValue);
  result.set("clearPerSync", state->clearPerSync);
  result.set("xLabel", state->xLabel);
  result.set("yLabel", state->yLabel);

  auto series = emscripten::val::array();
  for (auto &entry : state->series) {
    auto item = emscripten::val::object();
    item.set("name", entry.name);
    item.set("label", entry.label);
    item.set("x", emscripten::val(makeView(entry.x, 1, ScalarType::Float32)));
    item.set("y", emscripten::val(makeView(entry.y, 1, ScalarType::Float32)));
    series.call<void>("push", item);
  }
  result.set("series", series);
  return result;
}

void LAMMPSWeb::setBondDistance(std::int32_t type1, std::int32_t type2, double distance) {
  if (distance <= 0) {
    return;
  }
  m_bondDistances[{type1, type2}] = distance;
  m_bondDistances[{type2, type1}] = distance;
}

void LAMMPSWeb::clearBondDistances() {
  m_bondDistances.clear();
}

void LAMMPSWeb::setBuildNeighborlist(bool build) {
  m_buildNeighborlist = build;
  auto *sim = raw();
  if (!sim || !sim->modify) {
    return;
  }
  for (int i = 0; i < sim->modify->nfix; ++i) {
    if (auto *fix = dynamic_cast<LAMMPS_NS::FixJsAsync *>(sim->modify->fix[i])) {
      fix->build_neighborlist = build;
    }
  }
}

double LAMMPSWeb::bondDistanceFor(int type1, int type2) const noexcept {
  const auto it = m_bondDistances.find({type1, type2});
  return it == m_bondDistances.end() ? 0.0 : it->second;
}

void LAMMPSWeb::appendNeighborlistBonds(bool wrapped) {
  auto *sim = raw();
  if (!m_buildNeighborlist || m_bondDistances.empty() || !sim || !sim->modify) {
    return;
  }

  // Find a js/async fix whose occasional list was built on this timestep;
  // also (re)apply the build flag so fixes defined later pick it up.
  LAMMPS_NS::FixJsAsync *asyncFix = nullptr;
  for (int i = 0; i < sim->modify->nfix; ++i) {
    if (auto *fix = dynamic_cast<LAMMPS_NS::FixJsAsync *>(sim->modify->fix[i])) {
      fix->build_neighborlist = true;
      if (fix->list &&
          fix->neighborlist_built_at_timestep ==
            static_cast<long long>(sim->update->ntimestep)) {
        asyncFix = fix;
        break;
      }
    }
  }
  if (!asyncFix) {
    return;
  }

  auto *atom = sim->atom;
  auto *domain = sim->domain;
  auto *list = asyncFix->list;
  auto *image = wrapped ? nullptr : static_cast<int *>(lammps_extract_atom(static_cast<void *>(sim), "image"));
  int *numneigh = list->numneigh;
  int **firstneigh = list->firstneigh;

  const auto numAtoms = static_cast<int>(atom->natoms);
  for (int i = 0; i < numAtoms && i < list->inum; ++i) {
    double first[3] = { atom->x[i][0], atom->x[i][1], atom->x[i][2] };
    if (image) {
      domain->unmap(first, image[i]);
    } else {
      domain->remap(first);
    }

    const int typeI = atom->type[i];
    int *jlist = firstneigh[i];
    const int jnum = numneigh[i];

    for (int jj = 0; jj < jnum; ++jj) {
      int j = jlist[jj];
      j &= NEIGHMASK;
      if (j >= numAtoms) {
        continue;  // ghost atom
      }

      const double maxDistance = bondDistanceFor(typeI, atom->type[j]);
      if (maxDistance <= 0) {
        continue;
      }

      double dx = atom->x[j][0] - atom->x[i][0];
      double dy = atom->x[j][1] - atom->x[i][1];
      double dz = atom->x[j][2] - atom->x[i][2];
      applyMinimumImage(domain, dx, dy, dz);
      if (dx * dx + dy * dy + dz * dz >= maxDistance * maxDistance) {
        continue;
      }

      m_bondsPosition1.push_back(static_cast<float>(first[0]));
      m_bondsPosition1.push_back(static_cast<float>(first[1]));
      m_bondsPosition1.push_back(static_cast<float>(first[2]));
      m_bondsPosition2.push_back(static_cast<float>(first[0] + dx));
      m_bondsPosition2.push_back(static_cast<float>(first[1] + dy));
      m_bondsPosition2.push_back(static_cast<float>(first[2] + dz));
    }
  }
}

LAMMPSWeb::BufferView LAMMPSWeb::getModifierPerAtom(const std::string &category,
                                                    const std::string &name) {
  auto *state = m_modifiers.find(category, name);
  if (!state || !state->isPerAtom || state->perAtomData.empty()) {
    return BufferView{};
  }
  return makeView(state->perAtomData, 1, ScalarType::Float64);
}

emscripten::val LAMMPSWeb::getWalls() {
  auto walls = emscripten::val::array();

  auto *sim = raw();
  if (!sim || !sim->modify || !sim->domain) {
    return walls;
  }

  auto *domain = sim->domain;
  for (int i = 0; i < sim->modify->nfix; ++i) {
    auto *wallFix = dynamic_cast<LAMMPS_NS::FixWall *>(sim->modify->fix[i]);
    if (!wallFix) {
      continue;
    }

    for (int m = 0; m < wallFix->nwall; ++m) {
      const int which = wallFix->wallwhich[m];  // 0-5: XLO, XHI, YLO, YHI, ZLO, ZHI
      const int style = wallFix->xstyle[m];     // 0-3: NONE, EDGE, CONSTANT, VARIABLE

      double position = 0.0;
      if (style == 1) {  // EDGE: wall sits on the box face
        const int dim = which / 2;
        position = (which % 2 == 0) ? domain->boxlo[dim] : domain->boxhi[dim];
      } else if (style == 2) {  // CONSTANT
        position = wallFix->coord0[m];
      } else {
        // NONE and VARIABLE walls have no fixed position to render.
        continue;
      }

      auto wall = emscripten::val::object();
      wall.set("which", which);
      wall.set("style", style);
      wall.set("position", position);
      wall.set("cutoff", 0.0);
      walls.call<void>("push", wall);
    }
  }

  return walls;
}

void LAMMPSWeb::resetStaticBuffers() noexcept {
  m_cellMatrix.fill(0.0f);
  m_boxSize.fill(0.0f);
  m_origo.fill(0.0f);
  m_particlePositions.clear();
  m_bondsPosition1.clear();
  m_bondsPosition2.clear();
}

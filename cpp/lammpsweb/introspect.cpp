#include "introspect.h"

#include "arg_info.h"
#include "atom.h"
#include "compute.h"
#include "compute_msd.h"
#include "compute_pressure.h"
#include "compute_rdf.h"
#include "compute_vacf.h"
#include "fix.h"
#include "fix_ave_chunk.h"
#include "fix_ave_histo.h"
#include "fix_ave_time.h"
#include "info.h"
#include "input.h"
#include "lammps.h"
#include "modify.h"
#include "update.h"
#include "variable.h"

namespace lammpsweb {

namespace {

std::string modifierKey(const std::string &category, const std::string &name) {
  return category + ":" + name;
}

// Default axis labels per compute style, matching what Atomify displayed.
void applyComputeLabels(ModifierState &state, LAMMPS_NS::Compute *compute) {
  if (dynamic_cast<LAMMPS_NS::ComputeRDF *>(compute)) {
    state.xLabel = "Distance";
    state.yLabel = "g(r)";
  } else if (dynamic_cast<LAMMPS_NS::ComputeMSD *>(compute)) {
    state.yLabel = "Mean square displacement";
  } else if (dynamic_cast<LAMMPS_NS::ComputeVACF *>(compute)) {
    state.yLabel = "<v(t)*v(0)>";
  } else if (dynamic_cast<LAMMPS_NS::ComputePressure *>(compute)) {
    state.yLabel = "Pressure";
  }
}

}  // namespace

Series &ModifierState::ensureSeries(const std::string &seriesName) {
  for (auto &entry : series) {
    if (entry.name == seriesName) {
      return entry;
    }
  }
  series.emplace_back();
  series.back().name = seriesName;
  series.back().label = seriesName;
  return series.back();
}

double ModifierState::simulationTime() const {
  const auto *update = lmp->update;
  return update->atime + update->dt * (update->ntimestep - update->atimestep);
}

bool ModifierState::sync() {
  if (category == "compute") {
    auto *compute = lmp->modify->get_compute_by_id(name);
    return compute && syncCompute(compute);
  }
  if (category == "fix") {
    auto *fix = lmp->modify->get_fix_by_id(name);
    return fix && syncFix(fix);
  }
  return syncVariable();
}

bool ModifierState::syncCompute(LAMMPS_NS::Compute *compute) {
  if (!executeCompute(lmp, compute)) {
    return true;  // not allowed to invoke on this timestep; keep old data
  }
  if (syncComputePerAtom(compute)) {
    return true;
  }

  if (auto *rdf = dynamic_cast<LAMMPS_NS::ComputeRDF *>(compute)) {
    clearPerSync = true;
    const int numBins = rdf->size_array_rows;
    const int numPairs = (rdf->size_array_cols - 1) / 2;
    for (int pairId = 0; pairId < numPairs; ++pairId) {
      auto &data = ensureSeries("g(r) pair " + std::to_string(pairId + 1));
      data.clear();
      for (int bin = 0; bin < numBins; ++bin) {
        data.add(static_cast<float>(rdf->array[bin][0]),
                 static_cast<float>(rdf->array[bin][1 + 2 * pairId]));
      }
    }
    xLabel = "r";
    yLabel = "RDF";
    return true;
  }

  if (auto *msd = dynamic_cast<LAMMPS_NS::ComputeMSD *>(compute)) {
    static const char *names[] = {"dx2", "dy2", "dz2", "dr2"};
    static const char *labels[] = {"∆x^2", "∆y^2", "∆z^2", "∆r^2"};
    for (int i = 0; i < 4; ++i) {
      auto &data = ensureSeries(names[i]);
      data.label = labels[i];
      data.add(static_cast<float>(simulationTime()), static_cast<float>(msd->vector[i]));
    }
    xLabel = "Time";
    yLabel = "Mean square displacement";
    return true;
  }

  if (auto *vacf = dynamic_cast<LAMMPS_NS::ComputeVACF *>(compute)) {
    static const char *names[] = {"vx2", "vy2", "vz2", "vr2"};
    static const char *labels[] = {"<vx, vx0>", "<vy, vy0>", "<vz, vz0>", "<v, v0>"};
    for (int i = 0; i < 4; ++i) {
      auto &data = ensureSeries(names[i]);
      data.label = labels[i];
      data.add(static_cast<float>(simulationTime()), static_cast<float>(vacf->vector[i]));
    }
    xLabel = "Time";
    yLabel = "VACF";
    return true;
  }

  if (auto *pressure = dynamic_cast<LAMMPS_NS::ComputePressure *>(compute)) {
    hasScalar = true;
    scalarValue = static_cast<float>(pressure->scalar);
    auto &data = ensureSeries("Pressure");
    data.add(static_cast<float>(simulationTime()), scalarValue);
    static const char *components[] = {"Pxx", "Pyy", "Pzz", "Pxy", "Pxz", "Pyz"};
    for (int i = 0; i < 6; ++i) {
      auto &component = ensureSeries(components[i]);
      component.add(static_cast<float>(simulationTime()),
                    static_cast<float>(pressure->vector[i]));
    }
    xLabel = "Time";
    yLabel = "Pressure";
    return true;
  }

  if (compute->scalar_flag == 1) {
    hasScalar = true;
    scalarValue = static_cast<float>(compute->scalar);
    auto &data = ensureSeries("scalar");
    data.label = name;
    data.add(static_cast<float>(simulationTime()), scalarValue);
  }
  return true;
}

bool ModifierState::syncComputePerAtom(LAMMPS_NS::Compute *compute) {
  if (!compute->peratom_flag) {
    return false;
  }
  isPerAtom = true;

  // Exact size, like the atom-style variable path: the buffer length is the
  // contract for getModifierPerAtom, so it must shrink when atoms are
  // deleted or stale trailing values would be reported.
  const auto numAtoms = static_cast<std::size_t>(lmp->atom->natoms);
  perAtomData.resize(numAtoms);

  if (compute->size_peratom_cols == 0) {
    for (std::size_t i = 0; i < numAtoms; ++i) {
      perAtomData[i] = compute->vector_atom[i];
    }
  } else {
    for (std::size_t i = 0; i < numAtoms; ++i) {
      perAtomData[i] = compute->array_atom[i][0];
    }
  }
  return true;
}

bool ModifierState::syncFix(LAMMPS_NS::Fix *fix) {
  auto *aveTime = dynamic_cast<LAMMPS_NS::FixAveTime *>(fix);
  if (!aveTime) {
    return true;  // ave/histo and ave/chunk extraction not implemented yet
  }
  if (nextValidTimestep > lmp->update->ntimestep) {
    return true;  // not ready to measure yet
  }

  enum { SCALAR, VECTOR };
  const int nrows = aveTime->getnrows();
  const int nvalues = aveTime->getnvalues();
  const int mode = aveTime->getmode();
  const auto nextValid = aveTime->nextvalid();

  // +1 because the js/async step callback runs at end-of-step, one step
  // after the fix accumulated its result. Note that nextvalid() returns the
  // fix's next *sampling* step; for nrepeat > 1 the values read mid-window
  // are the running (partially averaged) accumulation rather than only the
  // final nfreq output — intentional for live plotting, and the same
  // behavior Atomify's wrapper always had. Reading only final averages
  // would need the fix's internal nvalid, tracked in a follow-up.
  if (nextValidTimestep + 1 == lmp->update->ntimestep) {
    if (mode == SCALAR) {
      if (nvalues == 1) {
        hasScalar = true;
        scalarValue = static_cast<float>(aveTime->compute_scalar());
        auto &data = ensureSeries("scalar");
        data.label = name;
        data.add(static_cast<float>(simulationTime()), scalarValue);
      } else {
        for (int i = 0; i < nvalues; ++i) {
          auto &data = ensureSeries("Value " + std::to_string(i + 1));
          data.add(static_cast<float>(simulationTime()),
                   static_cast<float>(aveTime->compute_vector(i)));
        }
      }
      xLabel = "Time";
      yLabel = "Value";
    } else {
      const auto &values = aveTime->getValues();
      for (int i = 0; i < nvalues; ++i) {
        const auto &value = values[i];

        // fix ave/time on a compute rdf: column 0 is bin centers, then
        // alternating g(r) / coord(r) per pair.
        LAMMPS_NS::ComputeRDF *rdf = nullptr;
        if (value.which == LAMMPS_NS::ArgInfo::COMPUTE) {
          rdf = dynamic_cast<LAMMPS_NS::ComputeRDF *>(
            lmp->modify->get_compute_by_id(value.id));
        }

        std::string key = "Value " + std::to_string(i + 1);
        if (rdf) {
          if (i == 0) {
            continue;  // bin centers, not a series
          }
          key = (i % 2 == 0)
            ? "g(r) pair " + std::to_string(i / 2)
            : "coord(r) pair " + std::to_string((i - 1) / 2);
        }

        auto &data = ensureSeries(key);
        data.clear();
        clearPerSync = true;

        for (int j = 0; j < nrows; ++j) {
          const float x = rdf ? static_cast<float>(rdf->array[j][0]) : static_cast<float>(j);
          data.add(x, static_cast<float>(aveTime->compute_array(j, i)));
        }
      }
    }
  }

  nextValidTimestep = nextValid;
  return true;
}

bool ModifierState::syncVariable() {
  auto *variable = lmp->input->variable;
  const int ivar = variable->find(name.c_str());
  if (ivar < 0) {
    return false;
  }

  if (variable->equalstyle(ivar)) {
    hasScalar = true;
    scalarValue = static_cast<float>(variable->compute_equal(ivar));
    auto &data = ensureSeries("scalar");
    data.label = name;
    data.add(static_cast<float>(simulationTime()), scalarValue);
  }

  if (variable->atomstyle(ivar)) {
    isPerAtom = true;
    const auto numAtoms = static_cast<std::size_t>(lmp->atom->natoms);
    perAtomData.resize(numAtoms);
    variable->compute_atom(ivar, /* igroup all */ 0, perAtomData.data(), 1, 0);
  }
  return true;
}

bool executeCompute(LAMMPS_NS::LAMMPS *lmp, LAMMPS_NS::Compute *compute) {
  const auto *update = lmp->update;
  // Energy/pressure contributions only exist on timesteps where LAMMPS
  // tallied them; invoking the compute on other steps is a LAMMPS error.
  if ((compute->peflag || compute->peatomflag) && update->ntimestep != update->eflag_global) {
    return false;
  }
  if ((compute->pressflag || compute->pressatomflag) &&
      update->ntimestep != update->vflag_global) {
    return false;
  }

  bool didCompute = false;
  if (compute->scalar_flag == 1) {
    compute->compute_scalar();
    didCompute = true;
  }
  if (compute->vector_flag == 1) {
    compute->compute_vector();
    didCompute = true;
  }
  if (compute->array_flag == 1) {
    compute->compute_array();
    didCompute = true;
  }
  if (compute->peratom_flag == 1) {
    compute->compute_peratom();
    didCompute = true;
  }
  return didCompute;
}

void ModifierRegistry::refresh(LAMMPS_NS::LAMMPS *lmp) {
  if (!lmp || !lmp->modify || !lmp->input) {
    m_modifiers.clear();
    return;
  }

  // A tracked entry whose live object was redefined with a different style
  // (e.g. uncompute + compute with the same id) must be rebuilt, or its
  // metadata and accumulated series would silently describe the old one.
  const auto isCurrent = [this](const std::string &key, const char *style) {
    auto it = m_modifiers.find(key);
    if (it == m_modifiers.end()) {
      return false;
    }
    if (it->second.style == style) {
      return true;
    }
    m_modifiers.erase(it);
    return false;
  };

  // Computes
  for (int i = 0; i < lmp->modify->ncompute; ++i) {
    auto *compute = lmp->modify->compute[i];
    const auto key = modifierKey("compute", compute->id);
    if (isCurrent(key, compute->style)) {
      continue;
    }
    auto &state = m_modifiers[key];
    state.lmp = lmp;
    state.name = compute->id;
    state.category = "compute";
    state.style = compute->style;
    state.isPerAtom = compute->peratom_flag != 0;
    state.hasScalar = compute->scalar_flag != 0;
    applyComputeLabels(state, compute);
  }

  // Fixes
  for (int i = 0; i < lmp->modify->nfix; ++i) {
    auto *fix = lmp->modify->fix[i];
    const auto key = modifierKey("fix", fix->id);
    if (isCurrent(key, fix->style)) {
      continue;
    }
    auto &state = m_modifiers[key];
    state.lmp = lmp;
    state.name = fix->id;
    state.category = "fix";
    state.style = fix->style;
  }

  // Variables (equal- and atom-style only)
  auto *variable = lmp->input->variable;
  int nvar = 0;
  LAMMPS_NS::Info info(lmp);
  char **names = info.get_variable_names(nvar);
  for (int i = 0; i < nvar; ++i) {
    const int ivar = variable->find(names[i]);
    if (ivar < 0) {
      continue;
    }
    const bool equalStyle = variable->equalstyle(ivar);
    const bool atomStyle = variable->atomstyle(ivar);
    if (!equalStyle && !atomStyle) {
      continue;
    }
    const auto key = modifierKey("variable", names[i]);
    if (isCurrent(key, equalStyle ? "equal" : "atom")) {
      continue;
    }
    auto &state = m_modifiers[key];
    state.lmp = lmp;
    state.name = names[i];
    state.category = "variable";
    state.style = equalStyle ? "equal" : "atom";
    state.isPerAtom = atomStyle;
  }

  // Prune entries whose LAMMPS object no longer exists.
  for (auto it = m_modifiers.begin(); it != m_modifiers.end();) {
    const auto &state = it->second;
    bool alive = false;
    if (state.category == "compute") {
      alive = lmp->modify->get_compute_by_id(state.name) != nullptr;
    } else if (state.category == "fix") {
      alive = lmp->modify->get_fix_by_id(state.name) != nullptr;
    } else {
      alive = variable->find(state.name.c_str()) >= 0;
    }
    if (alive) {
      ++it;
    } else {
      it = m_modifiers.erase(it);
    }
  }
}

ModifierState *ModifierRegistry::find(const std::string &category, const std::string &name) {
  auto it = m_modifiers.find(modifierKey(category, name));
  return it == m_modifiers.end() ? nullptr : &it->second;
}

std::vector<ModifierState *> ModifierRegistry::list() {
  std::vector<ModifierState *> result;
  result.reserve(m_modifiers.size());
  for (auto &entry : m_modifiers) {
    result.push_back(&entry.second);
  }
  return result;
}

}  // namespace lammpsweb

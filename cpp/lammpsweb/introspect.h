#pragma once

#include <map>
#include <string>
#include <vector>

namespace LAMMPS_NS {
class LAMMPS;
class Compute;
class Fix;
}  // namespace LAMMPS_NS

namespace lammpsweb {

// One plottable x/y series belonging to a modifier (e.g. "Pxx", "g(r) pair 1").
struct Series {
  std::string name;   // stable key
  std::string label;  // display label
  std::vector<float> x;
  std::vector<float> y;

  void add(float xValue, float yValue) {
    x.push_back(xValue);
    y.push_back(yValue);
  }
  void clear() {
    x.clear();
    y.clear();
  }
};

// Tracked state for one compute/fix/variable, keyed by (category, name).
// Series data accumulates here between syncs. BufferViews handed to JS point
// straight into these vectors, so they are only valid until the next
// syncModifier/refresh (push_back can reallocate; pruning frees the state):
// consumers must copy what they need immediately and never cache a view.
struct ModifierState {
  LAMMPS_NS::LAMMPS *lmp = nullptr;
  std::string name;
  std::string category;  // "compute" | "fix" | "variable"
  std::string style;     // LAMMPS style string ("rdf", "ave/time", "equal", ...)
  std::string xLabel = "Time";
  std::string yLabel = "Value";
  bool clearPerSync = false;  // series x-axis is not time (histogram-like)
  bool hasScalar = false;
  float scalarValue = 0.0f;
  bool isPerAtom = false;
  std::vector<double> perAtomData;
  std::vector<Series> series;
  long long nextValidTimestep = -1;  // fix ave/time readiness

  Series &ensureSeries(const std::string &seriesName);
  double simulationTime() const;

  // Category-specific sync of scalar/series/per-atom data. Returns false if
  // the underlying LAMMPS object no longer exists.
  bool sync();

 private:
  bool syncCompute(LAMMPS_NS::Compute *compute);
  bool syncFix(LAMMPS_NS::Fix *fix);
  bool syncVariable();
  bool syncComputePerAtom(LAMMPS_NS::Compute *compute);
};

// Owns all tracked modifiers; mirrors what is currently defined in LAMMPS.
class ModifierRegistry {
 public:
  // Enumerate computes/fixes/variables in the running LAMMPS instance,
  // creating state for new ones and pruning ones that no longer exist.
  void refresh(LAMMPS_NS::LAMMPS *lmp);
  ModifierState *find(const std::string &category, const std::string &name);
  std::vector<ModifierState *> list();
  void clear() { m_modifiers.clear(); }

 private:
  std::map<std::string, ModifierState> m_modifiers;
};

// Invoke a compute's outputs, respecting LAMMPS' pe/press invocation rules.
// Returns true if anything was computed.
bool executeCompute(LAMMPS_NS::LAMMPS *lmp, LAMMPS_NS::Compute *compute);

}  // namespace lammpsweb

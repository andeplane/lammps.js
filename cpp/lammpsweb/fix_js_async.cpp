/* ----------------------------------------------------------------------
   LAMMPS - Large-scale Atomic/Molecular Massively Parallel Simulator
   https://www.lammps.org/, Sandia National Laboratories
   LAMMPS development team: developers@lammps.org

   Copyright (2003) Sandia Corporation.  Under the terms of Contract
   DE-AC04-94AL85000 with Sandia Corporation, the U.S. Government retains
   certain rights in this software.  This software is distributed under
   the GNU General Public License.

   See the README file in the top-level LAMMPS directory.
------------------------------------------------------------------------- */

#include "fix_js_async.h"

#include "comm.h"
#include "error.h"
#include "lammpsweb.h"
#include "neigh_list.h"
#include "neighbor.h"
#include "update.h"
#include "utils.h"

#include <cstdint>

using namespace LAMMPS_NS;
using namespace FixConst;

FixJsAsync::FixJsAsync(LAMMPS *lmp, int narg, char **arg) : Fix(lmp, narg, arg) {
  if (narg < 4) {
    utils::missing_cmd_args(FLERR, "fix js/async", error);
  }
  nevery = utils::inumeric(FLERR, arg[3], false, lmp);
  if (nevery <= 0) {
    error->all(FLERR, 3, "Illegal fix js/async nevery value {}; must be > 0", nevery);
  }
}

int FixJsAsync::setmask() {
  int mask = 0;
  mask |= END_OF_STEP;
  mask |= MIN_POST_FORCE;
  return mask;
}

void FixJsAsync::init() {
  // Occasional: only built when explicitly asked for via build_one().
  neighbor->add_request(this, NeighConst::REQ_OCCASIONAL);
}

void FixJsAsync::init_list(int /*id*/, NeighList *ptr) {
  list = ptr;
}

void FixJsAsync::maybeBuildNeighborlist() {
  if (!build_neighborlist || !list) {
    return;
  }
  neighbor->build_one(list);
  neighborlist_built_at_timestep = static_cast<long long>(update->ntimestep);
}

void FixJsAsync::end_of_step() {
  if (nevery <= 0) {
    nevery = 1;
  }
  if (update->ntimestep % nevery) {
    return;
  }
  if (comm->me != 0) {
    return;
  }

  maybeBuildNeighborlist();
  const bool ok = LAMMPSWebAsync::invokeStepCallbackAndWait(
    static_cast<std::int32_t>(update->ntimestep)
  );
  if (!ok) {
    error->all(FLERR, "JS async step callback rejected");
  }
}

void FixJsAsync::min_post_force(int) {
  ++step_count;
  if (nevery <= 0) {
    nevery = 1;
  }
  if (step_count % nevery) {
    return;
  }
  if (comm->me != 0) {
    return;
  }

  maybeBuildNeighborlist();
  const bool ok = LAMMPSWebAsync::invokeStepCallbackAndWait(
    static_cast<std::int32_t>(update->ntimestep)
  );
  if (!ok) {
    error->all(FLERR, "JS async step callback rejected");
  }
}

void FixJsAsync::setFrequency(int every) {
  if (every <= 0) {
    return;
  }
  nevery = every;
}

/* -*- c++ -*- ----------------------------------------------------------
   LAMMPS - Large-scale Atomic/Molecular Massively Parallel Simulator
   https://www.lammps.org/, Sandia National Laboratories
   LAMMPS development team: developers@lammps.org

   Copyright (2003) Sandia Corporation.  Under the terms of Contract
   DE-AC04-94AL85000 with Sandia Corporation, the U.S. Government retains
   certain rights in this software.  This software is distributed under
   the GNU General Public License.

   See the README file in the top-level LAMMPS directory.
------------------------------------------------------------------------- */

#ifdef FIX_CLASS
// clang-format off
FixStyle(js/async,FixJsAsync);
// clang-format on
#else

#ifndef LMP_FIX_JS_ASYNC_H
#define LMP_FIX_JS_ASYNC_H

#include "fix.h"

namespace LAMMPS_NS {

class FixJsAsync : public Fix {
 public:
  FixJsAsync(class LAMMPS *, int, char **);
  int setmask() override;
  void init() override;
  void init_list(int, class NeighList *) override;
  void end_of_step() override;
  void min_post_force(int) override;
  void setFrequency(int every);

  // Occasional half neighbor list, built per step only when
  // build_neighborlist is set (used for distance-based bond rendering).
  class NeighList *list = nullptr;
  bool build_neighborlist = false;
  long long neighborlist_built_at_timestep = -1;

 private:
  void maybeBuildNeighborlist();

  int nevery = 1;
  int step_count = 0;
};

}  // namespace LAMMPS_NS

#endif
#endif

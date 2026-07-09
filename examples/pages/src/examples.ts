export interface Example {
  name: string;
  script: string;
  /** How often (in timesteps) the async step callback yields to the UI. */
  every?: number;
  /**
   * Default state of the Multithreading checkbox when this example is
   * selected. When enabled, the run uses the KOKKOS build and the thread
   * count from the UI dropdown (passed to LAMMPS as `-k on t N`).
   */
  kokkos?: boolean;
}

export const examples: Example[] = [
  {
    name: "Lennard-Jones Cluster",
    script: `units           lj
timestep        0.001
atom_style      atomic
lattice         fcc 0.8442
region          box block 0 3 0 3 0 3
create_box      1 box
create_atoms    1 box
mass            1 1.0
velocity        all create 1.44 87287 loop geom
pair_style      lj/cut 2.5
pair_coeff      1 1 1.0 1.0 2.5
neighbor        0.3 bin
neigh_modify    every 1 delay 0 check yes
fix             1 all nve
compute         ctemp all temp
compute         cke all ke
thermo          500
run             50000`,
  },
  {
    name: "LJ Melt",
    script: `units           lj
timestep        0.005
atom_style      atomic
lattice         fcc 0.8442
region          box block 0 4 0 4 0 4
create_box      1 box
create_atoms    1 box
mass            1 1.0
velocity        all create 3.0 12345 loop geom
pair_style      lj/cut 2.5
pair_coeff      1 1 1.0 1.0 2.5
neighbor        0.3 bin
neigh_modify    every 20 delay 0 check yes
fix             1 all nvt temp 3.0 3.0 0.1
thermo          100
run             5000`,
  },
  {
    name: "Maxwell–Boltzmann distribution (2D)",
    every: 100,
    script: `# Give every atom the same speed in a random direction, then let
# collisions do the rest: within a few hundred steps the velocity
# distribution relaxes to the Maxwell–Boltzmann form (Boltzmann's
# H-theorem in action). A 2D gas with the purely repulsive WCA
# potential (LJ cut at its minimum) so energy stays kinetic.
units           lj
dimension       2
atom_style      atomic
lattice         sq 0.3
region          box block 0 32 0 32 -0.1 0.1
create_box      1 box
create_atoms    1 box
mass            1 1.0
pair_style      lj/cut 1.122462
pair_coeff      1 1 1.0 1.0
pair_modify     shift yes
velocity        all create 1.0 777 dist gaussian
variable        v0 equal 1.5
variable        s  atom v_v0/sqrt(vx*vx+vy*vy)
variable        ux atom vx*v_s
variable        uy atom vy*v_s
velocity        all set v_ux v_uy NULL
neighbor        0.3 bin
fix             1 all nve
fix             2d all enforce2d
thermo          200
run             4000`,
  },
  {
    name: "Condensation quench (2D)",
    every: 200,
    script: `# Take a hot 2D Lennard-Jones vapor and suddenly cool it below its
# condensation point. The uniform gas becomes unstable, droplets
# nucleate everywhere and then coarsen — a first-order phase
# transition, with the potential energy tracking the latent heat.
units           lj
dimension       2
atom_style      atomic
lattice         sq 0.3
region          box block 0 40 0 40 -0.1 0.1
create_box      1 box
create_atoms    1 box
mass            1 1.0
velocity        all create 1.0 8712 dist gaussian
pair_style      lj/cut 2.5
pair_coeff      1 1 1.0 1.0 2.5
neighbor        0.3 bin
fix             1 all nve
fix             lang all langevin 1.0 1.0 1.0 3216
fix             2d all enforce2d
thermo          1000
run             3000
# quench: drop the thermostat target below the condensation point
fix             lang all langevin 0.4 0.4 1.0 3216
run             20000`,
  },
  {
    name: "LJ Cluster (large, 1M atoms)",
    every: 10,
    script: `# ~1,000,188 atoms (63^3 fcc cells x 4) — runs in a Web Worker so
# the page stays responsive. Expect setup + 100 steps to take a few
# minutes and several hundred MB of memory.
units           lj
timestep        0.005
atom_style      atomic
lattice         fcc 0.8442
region          box block 0 63 0 63 0 63
create_box      1 box
create_atoms    1 box
mass            1 1.0
velocity        all create 1.44 87287 loop geom
pair_style      lj/cut 2.5
pair_coeff      1 1 1.0 1.0 2.5
neighbor        0.3 bin
neigh_modify    every 20 delay 0 check no
fix             1 all nve
thermo          10
run             100`,
  },
  {
    name: "Energy Minimization",
    script: `units           lj
atom_style      atomic
lattice         fcc 0.8442
region          box block 0 3 0 3 0 3
create_box      1 box
create_atoms    1 box
mass            1 1.0
pair_style      lj/cut 2.5
pair_coeff      1 1 1.0 1.0 2.5
neighbor        0.3 bin
neigh_modify    every 1 delay 0 check yes
thermo          10
minimize        1.0e-4 1.0e-6 1000 10000`,
  },
];

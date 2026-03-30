export interface Example {
  name: string;
  script: string;
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

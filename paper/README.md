# lammps.js JOSS draft

Read the [rendered JOSS proof](paper.pdf) or review the [Markdown manuscript](paper.md) and [bibliography](paper.bib). Make text and reference edits in the Markdown and BibTeX sources.

- Try the [lammps.js playground](https://andeplane.github.io/lammps.js/) and [interactive documentation](https://andeplane.github.io/lammps.js/docs/).
- Open the Elastic Network Editor's [rotating-squares](https://mendelsresearchgroup.github.io/elastic-network-editor/?example=rotating-squares) and [negative thermal expansion](https://mendelsresearchgroup.github.io/elastic-network-editor/?example=negative-thermal-expansion) examples. The [editor repository](https://github.com/MendelsResearchGroup/elastic-network-editor) contains the model inputs and reproduction scripts.
- See the [contributor guide](../CONTRIBUTING.md) for build and test instructions.

[Figure 1](figures/simulation-examples.png) uses snapshots from lammps.js 1.6.2. The network panels use the [rotating-squares compression protocol](https://github.com/MendelsResearchGroup/elastic-network-editor/tree/d7d6de88f37e6116d89eec134099afb7326bd90a/examples/rotating-squares) with the target strain set to `0.15` in `compress.deformation`. The case study reports the benchmark at 3%. The peptide panel uses the final coordinates from the LAMMPS [input script](https://raw.githubusercontent.com/lammps/lammps/stable_30Sep2026_update1/examples/peptide/in.peptide) and [data file](https://raw.githubusercontent.com/lammps/lammps/stable_30Sep2026_update1/examples/peptide/data.peptide), run with the `lammps.js/wasm-atomify-serial` build.

Before submission, confirm the author affiliations and the details of human review in the AI usage disclosure. The DOI and publication fields in the PDF are draft placeholders.

## Regenerate the proof

From the repository root in a Unix-like shell with Docker, run the [official JOSS renderer](https://joss.readthedocs.io/en/latest/paper.html#checking-that-your-paper-compiles):

```sh
docker run --rm --volume "$PWD/paper:/data" --user "$(id -u):$(id -g)" \
  --env JOURNAL=joss openjournals/inara
```

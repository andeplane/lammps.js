# lammps.js JOSS draft

Read the [rendered JOSS proof](paper.pdf) or review the [Markdown manuscript](paper.md) and [bibliography](paper.bib). Make text and reference edits in the Markdown and BibTeX sources.

- Try the [lammps.js playground](https://andeplane.github.io/lammps.js/) and [interactive documentation](https://andeplane.github.io/lammps.js/docs/).
- Open the Elastic Network Editor's [rotating-squares](https://mendelsresearchgroup.github.io/elastic-network-editor/?example=rotating-squares) and [negative thermal expansion](https://mendelsresearchgroup.github.io/elastic-network-editor/?example=negative-thermal-expansion) examples. The [editor repository](https://github.com/MendelsResearchGroup/elastic-network-editor) contains the model inputs and reproduction scripts.
- See the [contributor guide](../CONTRIBUTING.md) for build and test instructions.

Before submission, confirm the author affiliations and the details of human review in the AI usage disclosure. The DOI and publication fields in the PDF are draft placeholders.

## Regenerate the proof

From the repository root in a Unix-like shell with Docker, run the [official JOSS renderer](https://joss.readthedocs.io/en/latest/paper.html#checking-that-your-paper-compiles):

```sh
docker run --rm --volume "$PWD/paper:/data" --user "$(id -u):$(id -g)" \
  --env JOURNAL=joss openjournals/inara
```

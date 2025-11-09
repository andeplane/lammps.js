// Allow user to override locateFile, otherwise just return the path
if (!Module["locateFile"]) {
  Module["locateFile"] = (path, scriptDirectory_unused) => {
    return path;
  };
}

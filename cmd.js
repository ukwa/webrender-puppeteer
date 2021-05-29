const { render } = require("./renderer.js");

(async () => {
  const url = process.argv[2];
  render(url)
})();



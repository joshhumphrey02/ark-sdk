import { main } from "./main";

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});

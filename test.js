// Запуск: node test.js
const fs = require("fs");
const path = require("path");
const { html2json } = require("./html2json.js");

const samplesDir = path.join(__dirname, "html_samples");
let failed = 0;

// 1) Усі семпли: не падає, немає поля error, результат серіалізується в JSON
for (const file of fs.readdirSync(samplesDir).sort()) {
  const text = fs.readFileSync(path.join(samplesDir, file), "utf8");
  try {
    const started = Date.now();
    const result = html2json(text);
    const json = JSON.stringify(result, null, 2);
    if (result.error) throw new Error(result.error);
    console.log(`OK    ${file}  (${text.length} симв. -> ${json.length} симв., ${Date.now() - started} мс)`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${file}: ${error.message}`);
  }
}

// 2) Перевірка конкретних очікувань
function check(name, condition) {
  if (condition) console.log(`OK    ${name}`);
  else { failed++; console.log(`FAIL  ${name}`); }
}

const r1 = html2json('<div class="box"><p>Hello</p><br></div>');
const div = r1.children[0];
check("div має class=box", div.tag === "div" && div.attributes.class === "box");
check("div має 2 дітей (p, br)", div.children.length === 2);
check("p містить текст Hello", div.children[0].children[0].content === "Hello");
check("br без дітей", div.children[1].tag === "br" && div.children[1].children.length === 0);

const r2 = html2json("<ul><li>a<li>b</ul>");
check("незакриті <li> стають сусідами", r2.children[0].children.length === 2);

const r3 = html2json("<script>if (a<b) {}</script>");
check("< у script - це текст", r3.children[0].children[0].content === "if (a<b) {}");

const r4 = html2json("<p>Tom &amp; Jerry</p>");
check("&amp; декодується", r4.children[0].children[0].content === "Tom & Jerry");

check("null не падає", html2json(null).children.length === 0);
check("порожній рядок не падає", html2json("").children.length === 0);

console.log(failed === 0 ? "\nУСІ ТЕСТИ ПРОЙДЕНО" : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);

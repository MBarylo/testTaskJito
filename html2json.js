function convertHtml2JsonAndSet() {
  const htmlTextAreaValue = document.getElementById('html').value
  const jsonObj = html2json(htmlTextAreaValue)
  const jsonArea = document.getElementById('json')
  jsonArea.textContent = JSON.stringify(jsonObj, null, 2)
}

;('use strict')

/* ====================================================================
 *  1. ІНТЕРФЕЙС (кнопка "Convert to JSON")
 * ==================================================================== */

// Викликається при натисканні на кнопку "Convert to JSON".
function convertHtml2JsonAndSet() {
  // Беремо текст, який користувач ввів у ліве поле (textarea з id="html")
  const htmlTextAreaValue = document.getElementById('html').value
  // Праве поле, куди виведемо результат
  const jsonArea = document.getElementById('json')

  try {
    // Перетворюємо HTML-рядок на JS-об'єкт (дерево)
    const jsonObj = html2json(htmlTextAreaValue)
    // JSON.stringify(об'єкт, null, 2) робить гарний текст з відступами по 2 пробіли
    jsonArea.textContent = JSON.stringify(jsonObj, null, 2)
  } catch (error) {
    // Страховка: якщо щось несподівано зламається, сторінка не "впаде",
    // а просто покаже текст помилки.
    jsonArea.textContent = `Conversion failed: ${error.message}`
  }
}

/* ====================================================================
 *  2. КОНСТАНТИ (довідники, якими користується парсер)
 *
 *  Скрізь використано Set і Map, а не звичайні об'єкти {}.
 *  Причина: у звичайного об'єкта вже є "вбудовані" ключі
 *  (наприклад, "constructor"), і тег <constructor> міг би зламати код.
 * ==================================================================== */

// "Порожні" теги: у них немає вмісту й закриваючого тегу (<br>, а не <br></br>).
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

// Теги, всередині яких усе вважається звичайним ТЕКСТОМ, а не тегами.
// Наприклад, у <script>if (a<b)</script> символ "<" - це не початок тегу.
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title'])

// З цих двох тегів потрібно "розшифровувати" &amp; &lt; тощо.
// У script і style цього робити не можна - там це частина коду.
const TAGS_WITH_DECODED_ENTITIES = new Set(['textarea', 'title'])

// Теги, у яких пробіли й переноси рядків важливі, тому їх не чіпаємо.
const WHITESPACE_SENSITIVE_TAGS = new Set(['pre', 'textarea'])

// "Неявне закриття" тегів. Приклад: у <li>a<li>b перший <li> ніхто не закрив,
// але другий <li> означає, що перший уже закінчився.
// Читати так: "якщо відкривається ключ - закриваємо відкриті теги зі списку".
const IMPLIED_CLOSERS = new Map([
  ['li', ['li']],
  ['dt', ['dt', 'dd']],
  ['dd', ['dt', 'dd']],
  ['option', ['option']],
  ['tr', ['td', 'th', 'tr']],
  ['td', ['td', 'th']],
  ['th', ['td', 'th']],
])

// Блочні теги, які автоматично закривають відкритий <p>.
// Приклад: у <p>text<div> абзац закінчується перед <div>.
const BLOCK_TAGS_THAT_CLOSE_P = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'fieldset',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
])

// Словник "сутностей": що означає запис &amp; &lt; і т.д.
const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00A0'],
  ['copy', '\u00A9'],
  ['reg', '\u00AE'],
  ['hellip', '\u2026'],
  ['mdash', '\u2014'],
  ['ndash', '\u2013'],
])

// Максимальна глибина вкладення тегів (браузери теж мають таку межу).
// Потрібна, щоб JSON.stringify не впав на надто глибокому дереві.
const MAX_DEPTH = 512

// Регулярний вираз для закриваючого тегу, наприклад </div> або </div  >.
//   <\/            - символи "</"
//   ([a-zA-Z][^\s/>]*) - ім'я тегу (перша літера + решта до пробілу, / або >); це "група 1"
//   [^>]*          - будь-що до ">" (на випадок зайвих символів)
//   (?:>|$)        - сам ">" або кінець тексту
//   прапорець y    - "sticky": шукати збіг ТІЛЬКИ рівно з позиції lastIndex
const CLOSING_TAG_REGEX = /<\/([a-zA-Z][^\s/>]*)[^>]*(?:>|$)/y

// Регулярний вираз для сутностей: &amp; або &#65; або &#x41;
//   прапорець g - шукати всі входження
const ENTITY_REGEX = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g

/* ====================================================================
 *  3. ГОЛОВНА ФУНКЦІЯ
 *
 *  Формат результату:
 *    { type: "document", children: [вузли...] }
 *  Вузол - це один з варіантів:
 *    { type: "element", tag, attributes: {назва: значення}, children: [вузли...] }
 *    { type: "text",    content }
 *    { type: "comment", content }
 *    { type: "doctype", content }
 * ==================================================================== */
function html2json(htmlText) {
  // Корінь дерева. У нього потім "підвішуємо" все, що знайдемо.
  const root = { type: 'document', children: [] }

  // Якщо нічого не передали - повертаємо порожній документ.
  if (htmlText === null || htmlText === undefined) return root

  try {
    // String(...) на випадок, якщо передали не рядок (наприклад, число)
    buildTree(String(htmlText), root)
  } catch (error) {
    // Функція НІКОЛИ не кидає помилку назовні.
    // Якщо щось пішло не так - повертаємо те, що встигли розібрати, + текст помилки.
    root.error = error && error.message ? error.message : String(error)
  }
  return root
}

/* ====================================================================
 *  4. ДРІБНІ ДОПОМІЖНІ ФУНКЦІЇ
 * ==================================================================== */

// Чи є символ англійською літерою? (теги починаються з літери)
// Перевірка на undefined потрібна, бо charAt за межами рядка дає undefined,
// а /[a-z]/.test(undefined) помилково повернув би true (бо "undefined" містить літери).
function isAsciiLetter(char) {
  return char !== undefined && /^[a-zA-Z]$/.test(char)
}

// Чи є символ пробільним (пробіл, таб, перенос рядка...)?
function isWhitespace(char) {
  return (
    char === ' ' ||
    char === '\n' ||
    char === '\t' ||
    char === '\r' ||
    char === '\f'
  )
}

// Перетворює "&amp;" -> "&", "&#65;" -> "A", "&lt;" -> "<" тощо.
function decodeEntities(text) {
  // Швидкий вихід: якщо немає "&", то й заміняти нічого
  if (text.indexOf('&') === -1) return text

  // replace викликає функцію для кожного знайденого збігу:
  //   match - весь збіг, наприклад "&#65;"
  //   body  - те, що між & і ;, наприклад "#65" або "amp"
  return text.replace(ENTITY_REGEX, (match, body) => {
    if (body[0] === '#') {
      // Числова сутність: &#65; (десяткова) або &#x41; (шістнадцяткова)
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      // Некоректний код (0, надто великий, не число) - залишаємо запис як є.
      // Без цієї перевірки String.fromCodePoint кинув би помилку.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      return String.fromCodePoint(code)
    }
    // Іменована сутність (&amp;): шукаємо у словнику, невідому залишаємо як є
    return NAMED_ENTITIES.has(body) ? NAMED_ENTITIES.get(body) : match
  })
}

/* ====================================================================
 *  5. РОЗБІР ВІДКРИВАЮЧОГО ТЕГУ
 *
 *  Приклад: <a href="x" disabled>
 *  Вхід:  html - весь текст, startPos - позиція символу "<"
 *  Вихід: { name, attributes, selfClosing, end }
 *     name        - ім'я тегу малими літерами ("a")
 *     attributes  - об'єкт атрибутів ({ href: "x", disabled: "" })
 *     selfClosing - чи закінчується тег на "/>"
 *     end         - позиція, з якої продовжувати читати після тегу
 *  Якщо тег обірвався (кінець тексту всередині тегу) - повертає null.
 * ==================================================================== */
function readOpeningTag(html, startPos) {
  const htmlLength = html.length
  let pos = startPos + 1 // пропускаємо символ "<"

  // --- Читаємо ім'я тегу: до пробілу, "/" або ">" ---
  const nameStart = pos
  while (
    pos < htmlLength &&
    !isWhitespace(html[pos]) &&
    html[pos] !== '/' &&
    html[pos] !== '>'
  ) {
    pos++
  }
  const tagName = html.slice(nameStart, pos).toLowerCase() // HTML нечутливий до регістру

  // Object.create(null) - об'єкт без "спадкових" ключів.
  // Інакше атрибут з назвою __proto__ зіпсував би об'єкт.
  const attributes = Object.create(null)

  // --- Читаємо атрибути по одному, поки не зустрінемо ">" ---
  while (pos < htmlLength) {
    // Пропускаємо пробіли між атрибутами
    while (pos < htmlLength && isWhitespace(html[pos])) pos++
    if (pos >= htmlLength) break

    const char = html[pos]

    // Кінець тегу: ">"
    if (char === '>')
      return { name: tagName, attributes, selfClosing: false, end: pos + 1 }

    // "/" - або кінець самозакритого тегу "/>", або просто зайвий символ
    if (char === '/') {
      if (html[pos + 1] === '>') {
        return { name: tagName, attributes, selfClosing: true, end: pos + 2 }
      }
      pos++
      continue
    }

    // --- Читаємо назву атрибута ---
    // Перший символ беремо завжди (навіть якщо це "="), щоб цикл гарантовано рухався вперед
    // і не зациклився на дивному вводі.
    const attrNameStart = pos
    pos++
    while (
      pos < htmlLength &&
      !isWhitespace(html[pos]) &&
      html[pos] !== '/' &&
      html[pos] !== '>' &&
      html[pos] !== '='
    ) {
      pos++
    }
    const attrName = html.slice(attrNameStart, pos).toLowerCase()

    // Пропускаємо пробіли перед можливим "="
    while (pos < htmlLength && isWhitespace(html[pos])) pos++

    // --- Читаємо значення (якщо воно є) ---
    let attrValue = '' // атрибут без значення (disabled) отримує ""
    if (html[pos] === '=') {
      pos++
      while (pos < htmlLength && isWhitespace(html[pos])) pos++

      const quote = html[pos]
      if (quote === '"' || quote === "'") {
        // Значення в лапках: шукаємо закриваючу лапку такого самого виду
        const closingQuotePos = html.indexOf(quote, pos + 1)
        if (closingQuotePos === -1) return null // лапка не закрита - тег обірваний
        attrValue = html.slice(pos + 1, closingQuotePos)
        pos = closingQuotePos + 1
      } else {
        // Значення без лапок: читаємо до пробілу або ">"
        const valueStart = pos
        while (
          pos < htmlLength &&
          !isWhitespace(html[pos]) &&
          html[pos] !== '>'
        )
          pos++
        attrValue = html.slice(valueStart, pos)
      }
    }

    // Якщо один атрибут вказано двічі, як у браузерах, лишаємо ПЕРШИЙ
    if (!(attrName in attributes)) {
      attributes[attrName] = decodeEntities(attrValue)
    }
  }

  // Дійшли до кінця тексту, так і не знайшовши ">" - тег обірваний
  return null
}

/* ====================================================================
 *  6. ПОБУДОВА ДЕРЕВА (головна робота)
 *
 *  Ідея: читаємо текст зліва направо й ведемо "стопку" (stack)
 *  тегів, які зараз відкриті. Верхній елемент стопки - це тег,
 *  у який ми зараз "заглибились". Усе нове додаємо йому в children.
 *
 *  Приклад для <div><p>Hi</p></div>:
 *    <div>  -> stack: [root, div]
 *    <p>    -> stack: [root, div, p]
 *    Hi     -> додаємо текст у p
 *    </p>   -> stack: [root, div]
 *    </div> -> stack: [root]
 * ==================================================================== */
function buildTree(html, root) {
  const htmlLength = html.length

  // Стопка відкритих елементів. Спочатку там тільки корінь.
  const openElements = [root]

  // Текст, який ми прочитали, але ще не додали в дерево.
  // Накопичуємо його, бо текст може йти шматками
  // (наприклад, "a < b" розбивається через символ "<").
  let pendingText = ''

  // Скільки відкритих тегів <pre>/<textarea> зараз над нами.
  // Якщо > 0, пробіли в тексті не чіпаємо.
  let whitespaceSensitiveDepth = 0

  // Поточна позиція в тексті (де ми зараз читаємо)
  let pos = 0

  // ---------- Допоміжні функції всередині buildTree ----------

  // Елемент, у який зараз додаємо вміст (верх стопки)
  const getCurrentElement = () => openElements[openElements.length - 1]

  // Перетворює накопичений pendingText на текстовий вузол і додає в поточний елемент.
  const savePendingText = () => {
    if (!pendingText) return

    let text = pendingText
    pendingText = '' // очищаємо буфер

    // Поза <pre>/<textarea> згортаємо послідовності пробілів в один і обрізаємо краї
    if (whitespaceSensitiveDepth === 0) {
      text = text.replace(/\s+/g, ' ').trim()
    }
    // Порожні (суто пробільні) тексти відкидаємо
    if (text) {
      getCurrentElement().children.push({
        type: 'text',
        content: decodeEntities(text),
      })
    }
  }

  // Додає готовий вузол (елемент, коментар, doctype) у поточний елемент.
  // Спершу зберігаємо накопичений текст, щоб зберегти правильний порядок.
  const addChildToCurrent = (node) => {
    savePendingText()
    getCurrentElement().children.push(node)
  }

  // "Закриває" елементи зі стопки, поки в ній не лишиться rest штук.
  const shrinkStackTo = (rest) => {
    while (openElements.length > rest) {
      const removed = openElements.pop()
      if (WHITESPACE_SENSITIVE_TAGS.has(removed.tag)) whitespaceSensitiveDepth--
    }
  }

  // Неявне закриття: перед відкриттям тегу newTagName закриваємо ті відкриті теги,
  // які він автоматично завершує (<li> закриває <li>, <div> закриває <p> тощо).
  const closeImpliedTags = (newTagName) => {
    savePendingText() // текст належить тегу, що закривається, тому зберігаємо його зараз
    const tagsToClose = IMPLIED_CLOSERS.get(newTagName)

    // Цикл, бо може потрібно закрити кілька поспіль (<td> потім <tr>)
    while (openElements.length > 1) {
      const currentTag = getCurrentElement().tag
      const shouldClose =
        (tagsToClose !== undefined && tagsToClose.includes(currentTag)) ||
        (currentTag === 'p' && BLOCK_TAGS_THAT_CLOSE_P.has(newTagName))
      if (!shouldClose) break
      shrinkStackTo(openElements.length - 1) // прибрати верхній елемент
    }
  }

  // Обробка закриваючого тегу </name>.
  const handleClosingTag = (name) => {
    // Шукаємо знизу вгору (з кінця стопки) відкритий тег з таким самим ім'ям.
    // idx > 0, бо на позиції 0 лежить корінь - його закривати не можна.
    for (let idx = openElements.length - 1; idx > 0; idx--) {
      if (openElements[idx].tag === name) {
        savePendingText() // накопичений текст належить елементу, що закривається
        shrinkStackTo(idx) // закриваємо його і все, що було відкрито всередині
        return
      }
    }
    // Якщо відповідного відкритого тегу немає (зайвий </div>) - просто ігноруємо.
  }

  // Читає вміст "сирих" тегів (script, style, textarea, title):
  // усе до відповідного закриваючого тегу - це один шматок тексту.
  const readRawTextContent = (element) => {
    // Шукаємо "</script" (або style і т.д.) без урахування регістру (прапорець i).
    // (?=[\s/>]|$) - після імені має йти пробіл, "/", ">" або кінець тексту,
    // щоб </scripts> не вважався закриттям <script>.
    const closingRegex = new RegExp(`</${element.tag}(?=[\\s/>]|$)`, 'gi')
    closingRegex.lastIndex = pos // починаємо пошук з поточної позиції
    const match = closingRegex.exec(html)

    // Кінець вмісту: де знайдено закриваючий тег, або кінець всього тексту
    const contentEnd = match ? match.index : htmlLength
    const rawContent = html.slice(pos, contentEnd)

    if (rawContent) {
      element.children.push({
        type: 'text',
        content: TAGS_WITH_DECODED_ENTITIES.has(element.tag)
          ? decodeEntities(rawContent)
          : rawContent,
      })
    }
    // Встаємо прямо на закриваючий тег; основний цикл його обробить
    // (а оскільки ці елементи в стопку не кладуться, цей закриваючий тег просто ігнорується).
    pos = contentEnd
  }

  // Обробка відкриваючого тегу, який уже розібрав readOpeningTag.
  const handleOpeningTag = ({ name, attributes, selfClosing }) => {
    closeImpliedTags(name)

    // Створюємо вузол-елемент
    const element = { type: 'element', tag: name, attributes, children: [] }
    addChildToCurrent(element)

    // <br>, <img/> тощо - вмісту немає, у стопку не кладемо
    if (selfClosing || VOID_ELEMENTS.has(name)) return

    // <script>, <textarea>... - читаємо вміст одним шматком, у стопку теж не кладемо
    if (RAW_TEXT_ELEMENTS.has(name)) {
      readRawTextContent(element)
      return
    }

    // Звичайний елемент: кладемо в стопку (якщо не перевищено ліміт глибини),
    // і подальший вміст потрапить усередину нього.
    if (openElements.length < MAX_DEPTH) {
      openElements.push(element)
      if (WHITESPACE_SENSITIVE_TAGS.has(name)) whitespaceSensitiveDepth++
    }
  }

  // ---------- Головний цикл: рухаємось по тексту зліва направо ----------
  while (pos < htmlLength) {
    // Шукаємо наступний символ "<" (початок можливого тегу)
    const tagStart = html.indexOf('<', pos)

    // Більше немає "<" - решта тексту це звичайний текст
    if (tagStart === -1) {
      pendingText += html.slice(pos)
      break
    }

    // Усе, що між поточною позицією і "<", - текст
    if (tagStart > pos) pendingText += html.slice(pos, tagStart)
    pos = tagStart

    // Символ одразу після "<" визначає, що це за конструкція
    const charAfterBracket = html[pos + 1]

    // --- Коментар: <!-- ... --> ---
    if (html.startsWith('<!--', pos)) {
      const commentEnd = html.indexOf('-->', pos + 4)
      addChildToCurrent({
        type: 'comment',
        // якщо "-->" немає, коментар триває до кінця тексту
        content: html.slice(
          pos + 4,
          commentEnd === -1 ? htmlLength : commentEnd,
        ),
      })
      pos = commentEnd === -1 ? htmlLength : commentEnd + 3
      continue
    }

    // --- <!DOCTYPE ...>, <?xml ...?>, <![CDATA[...]]> ---
    if (charAfterBracket === '!' || charAfterBracket === '?') {
      const declarationEnd = html.indexOf('>', pos + 2)
      const inner = html.slice(
        pos + 2,
        declarationEnd === -1 ? htmlLength : declarationEnd,
      )

      if (/^doctype/i.test(inner)) {
        // "DOCTYPE html" -> відкидаємо слово DOCTYPE (7 символів), лишаємо "html"
        addChildToCurrent({ type: 'doctype', content: inner.slice(7).trim() })
      } else {
        // Усе інше (<?xml ...?>, CDATA) зберігаємо як коментар
        addChildToCurrent({ type: 'comment', content: inner })
      }
      pos = declarationEnd === -1 ? htmlLength : declarationEnd + 1
      continue
    }

    // --- Закриваючий тег: </div> ---
    if (charAfterBracket === '/') {
      CLOSING_TAG_REGEX.lastIndex = pos // sticky: шукаємо рівно з цієї позиції
      const match = CLOSING_TAG_REGEX.exec(html)
      if (match) {
        handleClosingTag(match[1].toLowerCase()) // match[1] - ім'я тегу
        pos = CLOSING_TAG_REGEX.lastIndex // lastIndex - позиція одразу після збігу
      } else {
        // "</" без нормального імені (наприклад "</ >") - вважаємо звичайним текстом
        pendingText += '<'
        pos++
      }
      continue
    }

    // --- Відкриваючий тег: <div ...> (після "<" має йти літера) ---
    if (isAsciiLetter(charAfterBracket)) {
      const tag = readOpeningTag(html, pos)
      if (tag === null) break // тег обірвався в кінці тексту - ігноруємо решту
      pos = tag.end
      handleOpeningTag(tag)
      continue
    }

    // --- Усе інше: просто символ "<" у тексті (наприклад, "a < b") ---
    pendingText += '<'
    pos++
  }

  // Наприкінці зберігаємо текст, що міг залишитися в буфері
  savePendingText()
}

/* Нижче залиште showExample1() і showExample2() з оригінального файлу. */

// Дозволяє запускати тести в Node.js (node test.js); у браузері цей блок нічого не робить.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { html2json }
}

function showExample1() {
  const htmlExample = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport">
    <title>Sample HTML</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Website</h1>
    </header>
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <main>
        <section id="home">
            <h2>Home Section</h2>
            <p>This is the home section of the webpage.</p>
        </section>
        <section id="about">
            <h2>About Section</h2>
            <p>This is the about section of the webpage.</p>
        </section>
    </main>
    <footer>
        <p>&copy; 2024 My Website</p>
    </footer>
    <script src="script.js"></script>
</body>
</html>
`
  const jsonContent = {
    'Comment 1':
      'You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.',
    'Comment 2':
      'When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.',
  }

  document.getElementById('html').value = htmlExample
  document.getElementById('json').textContent = JSON.stringify(
    jsonContent,
    null,
    2,
  )
}

function showExample2() {
  const htmlExample = `<div>
<p>Hello world!</p>
  <button>Click me!</button>
  <textarea>Some very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very long string.</textarea>
</div>
`
  const jsonContent = {
    'Comment 1':
      'You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.',
    'Comment 2':
      'When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.',
  }

  document.getElementById('html').value = htmlExample
  document.getElementById('json').textContent = JSON.stringify(
    jsonContent,
    null,
    2,
  )
}

/* Transform cleaning-dashboard.html and hse-inspection.html for Step 2.8 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function extractStyle(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1].trim() : '';
}

function transformCleaning() {
  const file = 'cleaning-dashboard.html';
  let s = fs.readFileSync(path.join(root, file), 'utf8');

  const style = extractStyle(s);
  const cssPath = path.join(root, 'assets', 'empire-cleaning.css');
  const header =
    '/* Empire World EGS - cleaning dashboard extras (Phase 2 Step 2.8)\n' +
    ' * Load after assets/empire.css on cleaning-dashboard.html */\n\n';
  fs.writeFileSync(cssPath, header + style + '\n', 'utf8');

  s = s.replace(
    /<style>[\s\S]*?<\/style>/,
    [
      '<link rel="stylesheet" href="assets/empire.css">',
      '<link rel="stylesheet" href="assets/empire-cleaning.css">'
    ].join('\n')
  );

  if (!s.includes('assets/empire-core.js')) {
    s = s.replace(
      '    <script>',
      '    <script src="config.js"></script>\n    <script src="assets/empire-api.js"></script>\n    <script src="assets/empire-core.js"></script>\n    <script>'
    );
  }

  // Theme + sidebar bootstrap only (keep cleaning dialog with checkIconHtml)
  s = s.replace(
    /\/\* ===== Theme \(light default \+ dark toggle, remembered\) ===== \*\/\n\s*const TOGGLE_ICON = '[^']*';\n\s*function applyTheme\(t\)\{[\s\S]*?\(function\(\)\{ try\{ if\(localStorage\.getItem\('empire_sidebar_collapsed'\)==='1'\)\{ var sb=document\.getElementById\('sidebar'\); if\(sb\) sb\.classList\.add\('collapsed'\); \} \}catch\(e\)\{\} \}\)\(\);\n/,
    ''
  );

  s = s.replace(
    /const GOOGLE_SCRIPT_URL = '[^']+';\n\s*const LOADING_HTML = '[^']+';\n/,
    ''
  );

  const loginRe = /function handleLogin\(e\) \{[\s\S]*?\n        \}/;
  s = s.replace(
    loginRe,
    "function handleLogin(e) {\n" +
      "          e.preventDefault();\n" +
      "          const username = document.getElementById('loginUsername').value;\n" +
      "          const password = document.getElementById('loginPassword').value;\n" +
      "          const msg = document.getElementById('loginMessage');\n" +
      "          empireLogin({username:username, password:password, dept:'cleaning', messageEl:msg}).then(function(d){\n" +
      "            localStorage.setItem('isLoggedIn', 'true');\n" +
      "            localStorage.setItem('currentUser', username);\n" +
      "            localStorage.setItem('authToken', d.token||'');\n" +
      "            localStorage.setItem('userRole', d.role||'');\n" +
      "            enterDashboard();\n" +
      "          });\n" +
      "        }"
  );

  fs.writeFileSync(path.join(root, file), s, 'utf8');
  console.log('Updated', file, '-', s.split('\n').length, 'lines');
}

function transformHse() {
  const file = 'hse-inspection.html';
  let s = fs.readFileSync(path.join(root, file), 'utf8');

  const style = extractStyle(s);
  const cssPath = path.join(root, 'assets', 'empire-hse.css');
  const header =
    '/* Empire World EGS - HSE inspection extras (Phase 2 Step 2.8)\n' +
    ' * Load after assets/empire.css on hse-inspection.html */\n\n';
  fs.writeFileSync(cssPath, header + style + '\n', 'utf8');

  s = s.replace(
    /<style>[\s\S]*?<\/style>/,
    [
      '<link rel="stylesheet" href="assets/empire.css">',
      '<link rel="stylesheet" href="assets/empire-hse.css">'
    ].join('\n')
  );

  if (!s.includes('assets/empire-core.js')) {
    s = s.replace(
      '<script>',
      '<script src="config.js"></script>\n<script src="assets/empire-api.js"></script>\n<script src="assets/empire-core.js"></script>\n<script>'
    );
  }

  // Keep page icon helpers; remove only shared theme/sidebar/date/dialog/API duplicates
  s = s.replace(
    /\/\* ===== Theme \(light default \+ dark toggle, remembered\) ===== \*\/\n/,
    ''
  );
  s = s.replace(
    /var TOGGLE_ICON='[^']*';\n/,
    ''
  );
  s = s.replace(
    /function fmtDT\(s\)\{[\s\S]*?\nfunction dateOnly\(s\)\{[\s\S]*?\n/,
    ''
  );
  s = s.replace(
    /function applyTheme\(t\)\{[\s\S]*?\(function\(\)\{ try\{ if\(localStorage\.getItem\('empire_sidebar_collapsed'\)==='1'\)\{ var sb=document\.getElementById\('sidebar'\); if\(sb\) sb\.classList\.add\('collapsed'\); \} \}catch\(e\)\{\} \}\)\(\);\n/,
    ''
  );
  s = s.replace(
    /\/\* ===== Themed dialogs \(replace browser alert\/confirm\) ===== \*\/\n\(function\(\)\{[\s\S]*?window\.alert=function\(m\)\{ window\.uiAlert\(m\); \};\n\}\)\(\);\n/,
    ''
  );

  s = s.replace(
    /const GOOGLE_SCRIPT_URL = '[^']+';\nconst LOADING_HTML = '[^']+';\n/,
    ''
  );

  s = s.replace(
    /function fetchJSONRetry\(body, tries\)\{[\s\S]*?\}\n/,
    ''
  );

  const loginRe = /function handleLogin\(e\)\{[\s\S]*?\n\}/;
  s = s.replace(
    loginRe,
    "function handleLogin(e){\n" +
      "  e.preventDefault();\n" +
      "  const u=document.getElementById('loginUsername').value;\n" +
      "  const p=document.getElementById('loginPassword').value;\n" +
      "  const m=document.getElementById('loginMessage');\n" +
      "  empireLogin({username:u,password:p,dept:'hse',messageEl:m}).then(function(d){\n" +
      "    localStorage.setItem('hse_isLoggedIn','true');\n" +
      "    localStorage.setItem('hse_user',u);\n" +
      "    localStorage.setItem('hse_token',d.token||'');\n" +
      "    localStorage.setItem('hse_role',d.role||'');\n" +
      "    localStorage.setItem('hse_perms',JSON.stringify(d.perms||{}));\n" +
      "    PAGEPERMS=d.perms||{};\n" +
      "    enterApp();\n" +
      "    applyPerms();\n" +
      "  });\n" +
      "}"
  );

  fs.writeFileSync(path.join(root, file), s, 'utf8');
  console.log('Updated', file, '-', s.split('\n').length, 'lines');
}

transformCleaning();
transformHse();
console.log('Done');

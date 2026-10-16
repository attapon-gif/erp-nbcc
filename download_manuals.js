/**
 * SMART ERPG Manual Downloader
 * สำหรับดาวน์โหลดเอกสารคู่มือทั้งหมดจาก https://erp.iccs.ac.th/help/help01
 * วิทยาลัยชุมชนหนองบัวลำภู / สถาบันวิทยาลัยชุมชน (ICCS)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://erp.iccs.ac.th';
const HELP_URL = 'https://erp.iccs.ac.th/help/help01';
const WORK_DIR = path.resolve(__dirname);
const OUTPUT_DIR = path.join(WORK_DIR, 'คู่มือการใช้งาน');
const TOKEN_FILE = path.join(WORK_DIR, 'token.txt');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9222;

function sanitizeFilename(name) {
  if (!name) return 'เอกสาร';
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('==============================================================');
  console.log('   ระบบดาวน์โหลดคู่มือ SMART ERPG (วชช.หนองบัวลำภู)');
  console.log('   แหล่งข้อมูล: ' + HELP_URL);
  console.log('==============================================================\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let token = null;

  // 1. ตรวจสอบว่ามี Token บันทึกไว้แล้วหรือไม่
  if (fs.existsSync(TOKEN_FILE)) {
    const savedToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (savedToken.length > 20) {
      console.log('[*] พบ Token ใน token.txt กำลังตรวจสอบสถานะการเชื่อมต่อ...');
      const isValid = await testToken(savedToken);
      if (isValid) {
        console.log('[+] Token ใช้งานได้ถูกต้อง! เริ่มการดาวน์โหลดทันที\n');
        token = savedToken;
      } else {
        console.log('[-] Token เดิมหมดอายุ ระบบจะเปิดหน้าต่างเบราว์เซอร์ให้เข้าสู่ระบบใหม่\n');
      }
    }
  }

  // 2. หากยังไม่มี Token หรือหมดอายุ ให้เปิดเบราว์เซอร์ Edge เพื่อเข้าสู่ระบบ
  if (!token) {
    token = await captureTokenFromBrowser();
  }

  if (!token) {
    console.error('[!] ไม่ได้รับ Token ยืนยันตัวตน ยกเลิกการทำงาน');
    process.exit(1);
  }

  // บันทึก Token ล่าสุดเก็บไว้
  fs.writeFileSync(TOKEN_FILE, token, 'utf8');

  // 3. เริ่มขั้นตอนดาวน์โหลด
  console.log('\n--------------------------------------------------------------');
  console.log('[*] กำลังเชื่อมต่อ Content Server...');
  const contentConfig = await getContentConfig(token);
  console.log(`[+] ApiUrl: ${contentConfig.ApiUrl}`);
  console.log(`[+] DisplayUrl: ${contentConfig.DisplayUrl}`);

  console.log('\n[*] กำลังดึงสารบัญคู่มือทั้งหมดจาก help01/master...');
  const masterData = await getMasterData(token);
  const items = masterData?.itemTraining || [];
  console.log(`[+] พบรายการในสารบัญทั้งสิ้น: ${items.length} รายการ`);

  // บันทึกโครงสร้างข้อมูลดิบ
  fs.writeFileSync(
    path.join(WORK_DIR, 'raw_master_data.json'),
    JSON.stringify(masterData, null, 2),
    'utf8'
  );

  // 4. วนลูปดาวน์โหลดเอกสาร
  console.log('\n--------------------------------------------------------------');
  console.log('[*] กำลังเริ่มดาวน์โหลดไฟล์เอกสารคู่มือ...');
  console.log('--------------------------------------------------------------');

  const downloadResults = [];
  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const indexStr = String(i + 1).padStart(3, '0');
    const title = item.text || item.description || `คู่มือ_${indexStr}`;
    const contentId = item.content_id;

    const result = {
      index: i + 1,
      title: title,
      value: item.value,
      parentValue: item.parent_value,
      contentId: contentId,
      status: 'ไม่มีไฟล์แนบ',
      filename: null,
      localPath: null,
      sizeBytes: 0
    };

    if (!contentId || contentId <= 0) {
      console.log(`[${indexStr}/${items.length}] 📁 ${title} (หมวดหมู่หลัก)`);
      skipCount++;
      downloadResults.push(result);
      continue;
    }

    try {
      console.log(`[${indexStr}/${items.length}] 📥 ดึงข้อมูลไฟล์: ${title} (Content ID: ${contentId})...`);
      const fileInfo = await getContentInfo(contentConfig.ApiUrl, contentId, token);

      if (!fileInfo || !fileInfo.path) {
        console.log(`    [-] ไม่พบที่อยู่ไฟล์บน Content Server`);
        result.status = 'ไม่พบที่อยู่ไฟล์';
        downloadResults.push(result);
        continue;
      }

      const remotePath = fileInfo.path;
      const fileExt = path.extname(remotePath) || '.pdf';
      const safeFilename = `${indexStr}_${sanitizeFilename(title)}${fileExt}`;
      const targetFilePath = path.join(OUTPUT_DIR, safeFilename);

      const downloadUrl = remotePath.startsWith('http')
        ? remotePath
        : `${contentConfig.DisplayUrl.replace(/\/+$/, '')}/${remotePath.replace(/^\/+/, '')}`;

      console.log(`    ⬇️ ดาวน์โหลดจาก: ${downloadUrl}`);
      const downloadSuccess = await downloadFile(downloadUrl, targetFilePath, token);

      if (downloadSuccess && fs.existsSync(targetFilePath)) {
        const stats = fs.statSync(targetFilePath);
        const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`    ✅ ดาวน์โหลดสำเร็จ: ${safeFilename} (${sizeMb} MB)`);
        result.status = 'สำเร็จ';
        result.filename = safeFilename;
        result.localPath = targetFilePath;
        result.sizeBytes = stats.size;
        successCount++;
      } else {
        result.status = 'ดาวน์โหลดล้มเหลว';
      }
    } catch (err) {
      console.error(`    ❌ ผิดพลาด: ${err.message}`);
      result.status = `ผิดพลาด: ${err.message}`;
    }

    downloadResults.push(result);
    await sleep(200);
  }

  // 5. สรุปรายงาน
  console.log('\n==============================================================');
  console.log(`   เสร็จสิ้น! ดาวน์โหลดสำเร็จ: ${successCount} ไฟล์ | หมวดหมู่หลัก: ${skipCount}`);
  console.log('==============================================================');

  await generateReports(downloadResults, items);
  console.log(`\n[+] โฟลเดอร์เก็บเอกสาร: ${OUTPUT_DIR}`);
  console.log(`[+] รายงานสรุป: ${path.join(WORK_DIR, 'สรุปรายการคู่มือ_ERP.html')}`);
}

async function testToken(token) {
  try {
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/help01/master`, {
      headers: { Authorization: authHeader }
    });
    return res.status === 200;
  } catch (e) {
    return false;
  }
}

async function captureTokenFromBrowser() {
  const tempProfile = path.join(process.env.TEMP || 'C:\\Temp', `edge_erp_${Date.now()}`);

  console.log('[1] กำลังเปิด Microsoft Edge เพื่อให้ท่านเข้าสู่ระบบ...');
  console.log('    (กรุณากรอก Username/Password บนหน้าต่างที่เปิดขึ้นมา)');

  const edge = spawn(EDGE_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tempProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    HELP_URL
  ], { detached: true, stdio: 'ignore' });
  edge.unref();

  console.log('[2] กำลังเชื่อมต่อระบบดักจับสิทธิ์ (DevTools)...');
  await sleep(2500);

  let wsUrl = null;
  for (let retry = 0; retry < 20; retry++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('erp.iccs.ac.th')) || targets.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {
      await sleep(1000);
    }
  }

  if (!wsUrl) {
    throw new Error('ไม่สามารถเชื่อมต่อกับหน้าต่างเบราว์เซอร์ได้');
  }

  console.log('[3] เชื่อมต่อสำเร็จ! กำลังรอให้ท่าน Sign In เข้าสู่ระบบ...');
  console.log('    (ระบบจะดักจับ Token ทันทีที่ท่านกดเข้าสู่ระบบสำเร็จ)\n');

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let foundToken = null;

    const finalize = (t) => {
      if (!foundToken && t) {
        foundToken = t;
        console.log('\n[🎉] เข้าสู่ระบบสำเร็จ! ตรวจพบ Token เรียบร้อยแล้ว');
        try { ws.close(); } catch(e) {}
        resolve(foundToken);
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // ดักจับจาก Network Request Headers
        if (msg.method === 'Network.requestWillBeSent') {
          const req = msg.params.request;
          const auth = req.headers?.Authorization || req.headers?.authorization;
          if (auth && auth.startsWith('Bearer ') && auth.length > 50) {
            finalize(auth);
          }
        }

        // ดักจับจาก Response ของ token endpoint
        if (msg.method === 'Network.responseReceived') {
          const url = msg.params?.response?.url || '';
          if (url.includes('token') || url.includes('login') || url.includes('authenticate')) {
            // trigger check
            checkStorage();
          }
        }

        // ดักจับจาก Runtime evaluate
        if (msg.id === 200 && msg.result?.result?.value) {
          const val = msg.result.result.value;
          if (typeof val === 'string' && val.length > 50) {
            finalize(val);
          }
        }
      } catch (err) {}
    };

    function checkStorage() {
      if (foundToken || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({
          id: 200,
          method: 'Runtime.evaluate',
          params: {
            expression: `(() => {
              for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith('oidc.user:')) {
                  try {
                    const u = JSON.parse(sessionStorage.getItem(k));
                    if (u && u.access_token) return u.token_type ? (u.token_type + ' ' + u.access_token) : ('Bearer ' + u.access_token);
                  } catch(e) {}
                }
              }
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('oidc.user:')) {
                  try {
                    const u = JSON.parse(localStorage.getItem(k));
                    if (u && u.access_token) return u.token_type ? (u.token_type + ' ' + u.access_token) : ('Bearer ' + u.access_token);
                  } catch(e) {}
                }
              }
              return null;
            })()`,
            returnByValue: true
          }
        }));
      } catch (e) {}
    }

    const intervalId = setInterval(() => {
      if (foundToken) {
        clearInterval(intervalId);
        return;
      }
      // ตรวจสอบทั้ง Storage และ token.txt เผื่อผู้ใช้วางเอง
      checkStorage();
      if (fs.existsSync(TOKEN_FILE)) {
        try {
          const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
          if (t.length > 50) {
            clearInterval(intervalId);
            finalize(t);
          }
        } catch(e) {}
      }
    }, 1500);
  });
}

async function getContentConfig(token) {
  try {
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/parameter/ContentPath/`, {
      headers: { Authorization: authHeader }
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {}
  return { ApiUrl: BASE_URL, DisplayUrl: BASE_URL };
}

async function getMasterData(token) {
  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api/help01/master`, {
    headers: { Authorization: authHeader }
  });
  if (!res.ok) {
    throw new Error(`ไม่สามารถดึงข้อมูล help01/master ได้ (HTTP ${res.status})`);
  }
  return await res.json();
}

async function getContentInfo(apiUrl, contentId, token) {
  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const targetUrl = `${apiUrl.replace(/\/+$/, '')}/api/content?id=${contentId}&secure=none`;
  const res = await fetch(targetUrl, {
    headers: { Authorization: authHeader }
  });
  if (!res.ok) {
    throw new Error(`ดึง Content ไม่สำเร็จ (HTTP ${res.status})`);
  }
  return await res.json();
}

async function downloadFile(url, outputPath, token) {
  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader }
  });
  if (!res.ok) {
    return false;
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
  return true;
}

async function generateReports(results, allItems) {
  let md = `# สรุปรายการดาวน์โหลดคู่มือ SMART ERPG (วชช.หนองบัวลำภู)\n\n`;
  md += `* แหล่งที่มา: [https://erp.iccs.ac.th/help/help01](https://erp.iccs.ac.th/help/help01)\n`;
  md += `* วันที่และเวลาดึงข้อมูล: ${new Date().toLocaleString('th-TH')}\n`;
  md += `* โฟลเดอร์เก็บเอกสาร: \`คู่มือการใช้งาน/\`\n\n`;
  md += `| ลำดับ | หัวข้อคู่มือ / เอกสาร | Content ID | สถานะ | ชื่อไฟล์ที่ดาวน์โหลด | ขนาด |\n`;
  md += `| :---: | :--- | :---: | :---: | :--- | :---: |\n`;

  results.forEach((r) => {
    const sizeStr = r.sizeBytes > 0 ? `${(r.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : '-';
    const fileLink = r.filename ? `[${r.filename}](file:///D:/Users/ASUS/Desktop/อรรถพล/ERP/คู่มือการใช้งาน/${encodeURIComponent(r.filename)})` : '-';
    md += `| ${r.index} | **${r.title}** | ${r.contentId || '-'} | ${r.status} | ${fileLink} | ${sizeStr} |\n`;
  });

  fs.writeFileSync(path.join(WORK_DIR, 'สรุปรายการคู่มือ_ERP.md'), md, 'utf8');

  let html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>สารบัญและระบบจัดเก็บคู่มือ SMART ERPG</title>
  <style>
    body { font-family: 'Prompt', 'Segoe UI', Tahoma, sans-serif; background: #f0f2f5; margin: 0; padding: 25px; color: #333; }
    .container { max-width: 1200px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    h1 { color: #1a365d; margin-top: 0; border-bottom: 3px solid #3182ce; padding-bottom: 12px; font-size: 24px; }
    .stats { display: flex; gap: 20px; margin: 20px 0; }
    .stat-card { flex: 1; padding: 18px; border-radius: 8px; background: #ebf8ff; border: 1px solid #bee3f8; }
    .stat-card.success { background: #f0fff4; border-color: #c6f6d5; }
    .stat-num { font-size: 28px; font-weight: bold; color: #2b6cb0; margin-top: 5px; }
    .stat-card.success .stat-num { color: #2f855a; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #2b6cb0; color: #fff; text-align: left; padding: 12px 14px; font-weight: 500; }
    td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; }
    tr:hover { background: #f7fafc; }
    .badge { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .badge-success { background: #c6f6d5; color: #22543d; }
    .badge-skip { background: #edf2f7; color: #4a5568; }
    .badge-error { background: #fed7d7; color: #9b2c2c; }
    .btn-file { display: inline-block; padding: 6px 12px; background: #3182ce; color: #fff; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 500; }
    .btn-file:hover { background: #2b6cb0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📚 สารบัญและคลังคู่มือ SMART ERPG (วชช.หนองบัวลำภู)</h1>
    <p>ระบบรวบรวมเอกสารคู่มือการปฏิบัติงานจาก <strong>https://erp.iccs.ac.th/help/help01</strong></p>
    
    <div class="stats">
      <div class="stat-card">
        <div>รายการทั้งหมดในระบบ</div>
        <div class="stat-num">${results.length} รายการ</div>
      </div>
      <div class="stat-card success">
        <div>ไฟล์ที่ดาวน์โหลดสำเร็จ</div>
        <div class="stat-num">${results.filter((r) => r.status === 'สำเร็จ').length} ไฟล์</div>
      </div>
      <div class="stat-card">
        <div>หมวดหมู่ / ไม่มีไฟล์แนบ</div>
        <div class="stat-num">${results.filter((r) => r.status === 'ไม่มีไฟล์แนบ').length} หมวด</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 60px; text-align: center;">ลำดับ</th>
          <th>หัวข้อคู่มือการใช้งาน</th>
          <th style="width: 100px; text-align: center;">Content ID</th>
          <th style="width: 130px; text-align: center;">สถานะ</th>
          <th style="width: 100px; text-align: center;">ขนาด</th>
          <th style="width: 140px; text-align: center;">เปิดดูเอกสาร</th>
        </tr>
      </thead>
      <tbody>`;

  results.forEach((r) => {
    let badgeClass = 'badge-skip';
    if (r.status === 'สำเร็จ') badgeClass = 'badge-success';
    else if (r.status.includes('ล้มเหลว') || r.status.includes('ผิดพลาด')) badgeClass = 'badge-error';

    const sizeStr = r.sizeBytes > 0 ? `${(r.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : '-';
    const actionBtn = r.filename
      ? `<a href="คู่มือการใช้งาน/${encodeURIComponent(r.filename)}" target="_blank" class="btn-file">📄 เปิดไฟล์</a>`
      : '-';

    html += `
        <tr>
          <td style="text-align: center;">${r.index}</td>
          <td><strong>${r.title}</strong></td>
          <td style="text-align: center;">${r.contentId || '-'}</td>
          <td style="text-align: center;"><span class="badge ${badgeClass}">${r.status}</span></td>
          <td style="text-align: center;">${sizeStr}</td>
          <td style="text-align: center;">${actionBtn}</td>
        </tr>`;
  });

  html += `
      </tbody>
    </table>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(WORK_DIR, 'สรุปรายการคู่มือ_ERP.html'), html, 'utf8');
}

main().catch((err) => {
  console.error('\n[X] เกิดข้อผิดพลาดร้ายแรง:', err);
});

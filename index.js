 const { Telegraf } = require('telegraf');
const express = require('express');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');

// تهيئة التطبيق
const app = express();
const PORT = process.env.PORT || 3000;

// بيانات حالة البوت
const botStats = {
  startTime: new Date(),
  totalUsers: 0,
  totalConversions: 0,
  totalImagesProcessed: 0,
  recentConversions: [],
  activeUsers: new Set()
};

// تهيئة البوت (استبدل YOUR_TOKEN_HERE بالتوكن الحقيقي)
const bot = new Telegraf(process.env.BOT_TOKEN || 'YOUR_TOKEN_HERE');

// إنشاء مجلدات للتخزين
const uploadsDir = path.join(__dirname, 'uploads');
const pdfsDir = path.join(__dirname, 'pdfs');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(pdfsDir)) fs.mkdirSync(pdfsDir);

// معالجة أمر /start
bot.start((ctx) => {
  const userId = ctx.from.id;
  botStats.activeUsers.add(userId);
  botStats.totalUsers = botStats.activeUsers.size;
  
  ctx.replyWithHTML(
    '🖼️ <b>أهلاً بك في بوت تحويل الصور إلى PDF!</b>\n\n' +
    'يمكنك إرسال الصور لي وسأقوم بتحويلها إلى ملف PDF واحد.\n\n' +
    '📎 <b>طريقة الاستخدام:</b>\n' +
    '1. أرسل لي الصور واحدة تلو الأخرى\n' +
    '2. بعد الانتهاء من إرسال جميع الصور، اكتب <code>/pdf</code>\n' +
    '3. سأقوم بتحويل جميع الصور إلى ملف PDF واحد وإرساله لك\n\n' +
    '⚡ <b>مميزات البوت:</b>\n' +
    '• الحفاظ على الجودة الأصلية للصور\n' +
    '• الحفاظ على حجم الصور الأصلي\n' +
    '• دعم جميع أنواع الصور (JPG, PNG, WebP, etc.)\n' +
    '• إمكانية إضافة صور متعددة في ملف PDF واحد\n\n' +
    '📝 <b>الأوامر المتاحة:</b>\n' +
    '/start - عرض رسالة الترحيب\n' +
    '/pdf - تحويل الصور إلى PDF\n' +
    '/clear - مسح الصور المضافة\n' +
    '/status - عرض حالة البوت\n' +
    '/help - المساعدة'
  );
});

// معالجة أمر /help
bot.help((ctx) => {
  ctx.replyWithHTML(
    '❓ <b>كيفية استخدام البوت:</b>\n\n' +
    '1. أرسل لي الصور التي تريد تحويلها إلى PDF\n' +
    '2. بعد إرسال جميع الصور، اكتب <code>/pdf</code>\n' +
    '3. انتظر حتى أرسل لك ملف PDF يحتوي على جميع الصور\n\n' +
    '🔄 <b>لإعادة البدء:</b>\n' +
    'يمكنك استخدام <code>/clear</code> لمسح الصور المضافة والبدء من جديد\n\n' +
    '📊 <b>لعرض إحصائيات البوت:</b>\n' +
    'استخدم <code>/status</code>\n\n' +
    '🔗 <b>لوحة تحكم البوت على الويب:</b>\n' +
    `زور الرابط: http://localhost:${PORT}`
  );
});

// تخزين الصور لكل مستخدم
const userImages = new Map();

// معالجة الصور المرسلة
bot.on('photo', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    
    // الحصول على مسار الملف
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const fileName = `${userId}_${Date.now()}.jpg`;
    const filePath = path.join(uploadsDir, fileName);
    
    // تنزيل الصورة
    const response = await fetch(fileLink);
    const buffer = await response.arrayBuffer();
    
    // حفظ الصورة مؤقتًا
    fs.writeFileSync(filePath, Buffer.from(buffer));
    
    // تخزين معلومات الصورة
    if (!userImages.has(userId)) {
      userImages.set(userId, []);
    }
    
    userImages.get(userId).push({
      path: filePath,
      name: fileName,
      date: new Date()
    });
    
    botStats.totalImagesProcessed++;
    
    ctx.reply(`✅ تم حفظ الصورة ${userImages.get(userId).length}. أرسل المزيد من الصور أو اكتب /pdf للتحويل.`);
    
  } catch (error) {
    console.error('خطأ في معالجة الصورة:', error);
    ctx.reply('❌ حدث خطأ أثناء معالجة الصورة. يرجى المحاولة مرة أخرى.');
  }
});

// معالجة أمر /pdf
bot.command('pdf', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!userImages.has(userId) || userImages.get(userId).length === 0) {
    return ctx.reply('⚠️ لم تقم بإرسال أي صور بعد. أرسل بعض الصور أولاً.');
  }
  
  try {
    const images = userImages.get(userId);
    const pdfId = uuidv4();
    const pdfFileName = `${pdfId}.pdf`;
    const pdfPath = path.join(pdfsDir, pdfFileName);
    
    // إنشاء ملف PDF
    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);
    
    // إضافة كل صورة كصفحة منفصلة في PDF
    for (const image of images) {
      try {
        // قراءة الصورة باستخدام sharp للحصول على أبعادها
        const imageData = await sharp(image.path).metadata();
        
        // إنشاء صفحة جديدة بحجم الصورة
        doc.addPage({ 
          size: [imageData.width, imageData.height],
          margin: 0 
        });
        
        // إضافة الصورة إلى الصفحة
        doc.image(image.path, 0, 0, {
          width: imageData.width,
          height: imageData.height,
          fit: [imageData.width, imageData.height],
          align: 'center',
          valign: 'center'
        });
      } catch (imgError) {
        console.error(`خطأ في معالجة الصورة ${image.path}:`, imgError);
        continue;
      }
    }
    
    // إنهاء وثيقة PDF
    doc.end();
    
    // انتظار انتهاء الكتابة
    await new Promise((resolve) => {
      stream.on('finish', resolve);
    });
    
    // إرسال ملف PDF للمستخدم
    await ctx.replyWithDocument({
      source: pdfPath,
      filename: `converted_${Date.now()}.pdf`
    });
    
    // تحديث الإحصائيات
    botStats.totalConversions++;
    botStats.recentConversions.unshift({
      userId: userId,
      username: ctx.from.username || ctx.from.first_name,
      imagesCount: images.length,
      timestamp: new Date(),
      pdfId: pdfId
    });
    
    // الحفاظ على آخر 10 تحويلات فقط
    if (botStats.recentConversions.length > 10) {
      botStats.recentConversions.pop();
    }
    
    // مسح الصور المؤقتة لهذا المستخدم
    images.forEach(img => {
      try { fs.unlinkSync(img.path); } catch (e) {}
    });
    userImages.delete(userId);
    
    ctx.reply(`✅ تم تحويل ${images.length} صورة إلى PDF بنجاح!`);
    
  } catch (error) {
    console.error('خطأ في إنشاء PDF:', error);
    ctx.reply('❌ حدث خطأ أثناء إنشاء ملف PDF. يرجى المحاولة مرة أخرى.');
  }
});

// معالجة أمر /clear
bot.command('clear', (ctx) => {
  const userId = ctx.from.id;
  
  if (userImages.has(userId)) {
    // حذف الصور المؤقتة
    const images = userImages.get(userId);
    images.forEach(img => {
      try { fs.unlinkSync(img.path); } catch (e) {}
    });
    
    userImages.delete(userId);
    ctx.reply('🗑️ تم مسح جميع الصور المضافة. يمكنك البدء من جديد.');
  } else {
    ctx.reply('⚠️ لا توجد صور مضافة لحذفها.');
  }
});

// معالجة أمر /status
bot.command('status', (ctx) => {
  const userId = ctx.from.id;
  const userImageCount = userImages.has(userId) ? userImages.get(userId).length : 0;
  const uptime = Math.floor((new Date() - botStats.startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;
  
  ctx.replyWithHTML(
    `📊 <b>حالة البوت:</b>\n\n` +
    `👥 <b>إجمالي المستخدمين:</b> ${botStats.totalUsers}\n` +
    `📈 <b>إجمالي التحويلات:</b> ${botStats.totalConversions}\n` +
    `🖼️ <b>إجمالي الصور المعالجة:</b> ${botStats.totalImagesProcessed}\n` +
    `⏱️ <b>مدة التشغيل:</b> ${hours} ساعة, ${minutes} دقيقة, ${seconds} ثانية\n\n` +
    `👤 <b>حالتك الشخصية:</b>\n` +
    `📎 <b>عدد الصور المضافة:</b> ${userImageCount}\n\n` +
    `🔗 <b>لوحة التحكم:</b>\n` +
    `http://localhost:${PORT}`
  );
});

// معالجة النصوص العادية
bot.on('text', (ctx) => {
  if (!ctx.message.text.startsWith('/')) {
    ctx.reply('لتحويل الصور إلى PDF:\n1. أرسل الصور لي\n2. ثم اكتب /pdf\n\nاكتب /help للمساعدة.');
  }
});

// بدء البوت
bot.launch()
  .then(() => {
    console.log('✅ بوت تلجرام يعمل بنجاح!');
  })
  .catch((err) => {
    console.error('❌ فشل في تشغيل البوت:', err);
  });

// إعداد خادم Express لعرض واجهة الويب
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// صفحة الرئيسية
app.get('/', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html dir="rtl" lang="ar">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>بوت تحويل الصور إلى PDF</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      
      :root {
        --primary: #4361ee;
        --secondary: #3a0ca3;
        --success: #4cc9f0;
        --danger: #f72585;
        --light: #f8f9fa;
        --dark: #212529;
        --gray: #6c757d;
        --light-gray: #e9ecef;
      }
      
      body {
        background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        color: var(--dark);
        line-height: 1.6;
        min-height: 100vh;
        padding-bottom: 50px;
      }
      
      .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 20px;
      }
      
      header {
        background: linear-gradient(to right, var(--primary), var(--secondary));
        color: white;
        padding: 2rem 0;
        text-align: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        margin-bottom: 2rem;
      }
      
      header h1 {
        font-size: 2.5rem;
        margin-bottom: 0.5rem;
      }
      
      header p {
        font-size: 1.1rem;
        opacity: 0.9;
      }
      
      .bot-card {
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
        padding: 2rem;
        margin-bottom: 2rem;
      }
      
      .bot-card h2 {
        color: var(--primary);
        margin-bottom: 1.5rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid var(--light-gray);
        display: flex;
        align-items: center;
        gap: 10px;
      }
      
      .bot-card h2 i {
        color: var(--secondary);
      }
      
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
      }
      
      .stat-box {
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: white;
        padding: 1.5rem;
        border-radius: 10px;
        text-align: center;
        transition: transform 0.3s, box-shadow 0.3s;
      }
      
      .stat-box:hover {
        transform: translateY(-5px);
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.15);
      }
      
      .stat-box i {
        font-size: 2.5rem;
        margin-bottom: 1rem;
        opacity: 0.9;
      }
      
      .stat-value {
        font-size: 2.2rem;
        font-weight: bold;
        margin: 0.5rem 0;
      }
      
      .stat-label {
        font-size: 1rem;
        opacity: 0.9;
      }
      
      .conversions-list {
        margin-top: 2rem;
      }
      
      .conversion-item {
        background: var(--light-gray);
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-right: 4px solid var(--success);
      }
      
      .conversion-info h4 {
        color: var(--dark);
        margin-bottom: 0.3rem;
      }
      
      .conversion-info p {
        color: var(--gray);
        font-size: 0.9rem;
      }
      
      .conversion-images {
        background: var(--success);
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 20px;
        font-weight: bold;
      }
      
      .instructions {
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
        padding: 2rem;
        margin-bottom: 2rem;
      }
      
      .instructions h2 {
        color: var(--primary);
        margin-bottom: 1.5rem;
      }
      
      .steps {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
      }
      
      .step {
        text-align: center;
        padding: 1.5rem;
        background: var(--light);
        border-radius: 10px;
        transition: all 0.3s;
      }
      
      .step:hover {
        background: white;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.05);
      }
      
      .step i {
        font-size: 2.5rem;
        color: var(--primary);
        margin-bottom: 1rem;
      }
      
      .step h3 {
        color: var(--secondary);
        margin-bottom: 0.5rem;
      }
      
      .features {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1.5rem;
        margin-top: 2rem;
      }
      
      .feature {
        display: flex;
        align-items: center;
        gap: 15px;
        background: var(--light);
        padding: 1rem;
        border-radius: 8px;
      }
      
      .feature i {
        color: var(--success);
        font-size: 1.5rem;
      }
      
      .bot-link {
        text-align: center;
        margin-top: 2rem;
        padding: 2rem;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: white;
        border-radius: 12px;
      }
      
      .bot-link a {
        display: inline-block;
        background: white;
        color: var(--primary);
        padding: 0.8rem 2rem;
        border-radius: 50px;
        text-decoration: none;
        font-weight: bold;
        margin-top: 1rem;
        transition: all 0.3s;
      }
      
      .bot-link a:hover {
        background: var(--light);
        transform: scale(1.05);
      }
      
      footer {
        text-align: center;
        margin-top: 3rem;
        color: var(--gray);
        font-size: 0.9rem;
      }
      
      @media (max-width: 768px) {
        header h1 {
          font-size: 2rem;
        }
        
        .stats-grid {
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        }
        
        .step {
          padding: 1rem;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="container">
        <h1><i class="fas fa-robot"></i> بوت تحويل الصور إلى PDF</h1>
        <p>حول صورك إلى ملف PDF واحد مع الحفاظ على الجودة الأصلية</p>
      </div>
    </header>
    
    <div class="container">
      <div class="bot-card">
        <h2><i class="fas fa-chart-line"></i> إحصائيات البوت</h2>
        
        <div class="stats-grid">
          <div class="stat-box">
            <i class="fas fa-users"></i>
            <div class="stat-value" id="totalUsers">${botStats.totalUsers}</div>
            <div class="stat-label">إجمالي المستخدمين</div>
          </div>
          
          <div class="stat-box">
            <i class="fas fa-file-pdf"></i>
            <div class="stat-value" id="totalConversions">${botStats.totalConversions}</div>
            <div class="stat-label">إجمالي التحويلات</div>
          </div>
          
          <div class="stat-box">
            <i class="fas fa-images"></i>
            <div class="stat-value" id="totalImages">${botStats.totalImagesProcessed}</div>
            <div class="stat-label">الصور المعالجة</div>
          </div>
          
          <div class="stat-box">
            <i class="fas fa-clock"></i>
            <div class="stat-value" id="uptime">0</div>
            <div class="stat-label">مدة التشغيل</div>
          </div>
        </div>
        
        <div class="conversions-list" id="conversionsList">
          <h3 style="margin-bottom: 1rem; color: var(--dark);">آخر التحويلات</h3>
          ${botStats.recentConversions.length > 0 ? 
            botStats.recentConversions.map(conv => `
              <div class="conversion-item">
                <div class="conversion-info">
                  <h4>${conv.username}</h4>
                  <p>${new Date(conv.timestamp).toLocaleString('ar-SA')}</p>
                </div>
                <div class="conversion-images">${conv.imagesCount} صورة</div>
              </div>
            `).join('') : 
            '<p style="text-align: center; color: var(--gray);">لا توجد تحويلات حديثة</p>'
          }
        </div>
      </div>
      
      <div class="instructions">
        <h2><i class="fas fa-info-circle"></i> كيفية استخدام البوت</h2>
        
        <div class="steps">
          <div class="step">
            <i class="fas fa-paper-plane"></i>
            <h3>الخطوة الأولى</h3>
            <p>أرسل الصور التي تريد تحويلها إلى البوت</p>
          </div>
          
          <div class="step">
            <i class="fas fa-bolt"></i>
            <h3>الخطوة الثانية</h3>
            <p>اكتب <strong>/pdf</strong> لبدء عملية التحويل</p>
          </div>
          
          <div class="step">
            <i class="fas fa-download"></i>
            <h3>الخطوة الثالثة</h3>
            <p>استلم ملف PDF يحتوي على جميع صورك</p>
          </div>
        </div>
        
        <div class="features">
          <div class="feature">
            <i class="fas fa-check-circle"></i>
            <div>
              <h4>الحفاظ على الجودة</h4>
              <p>جودة الصور الأصلية محفوظة بالكامل</p>
            </div>
          </div>
          
          <div class="feature">
            <i class="fas fa-expand-alt"></i>
            <div>
              <h4>الحجم الأصلي</h4>
              <p>حجم الصور يبقى كما هو دون تغيير</p>
            </div>
          </div>
          
          <div class="feature">
            <i class="fas fa-images"></i>
            <div>
              <h4>صور متعددة</h4>
              <p>إمكانية إضافة عدد غير محدود من الصور</p>
            </div>
          </div>
          
          <div class="feature">
            <i class="fas fa-bolt"></i>
            <div>
              <h4>سرعة التحويل</h4>
              <p>تحويل سريع وفوري للصور إلى PDF</p>
            </div>
          </div>
        </div>
      </div>
      
      <div class="bot-link">
        <h3><i class="fab fa-telegram"></i> ابدأ استخدام البوت الآن</h3>
        <p>تواصل مع البوت على تلجرام وابدأ في تحويل صورك إلى PDF</p>
        <a href="https://t.me/${bot.botInfo?.username || 'your_bot_username'}" target="_blank">فتح البوت على تلجرام</a>
      </div>
    </div>
    
    <footer class="container">
      <p>© 2023 بوت تحويل الصور إلى PDF. تم التطوير باستخدام Node.js و Telegraf</p>
      <p>حالة الخادم: <span style="color: green; font-weight: bold;">● نشط</span></p>
    </footer>
    
    <script>
      // تحديث الوقت المنقضي
      function updateUptime() {
        const startTime = new Date("${botStats.startTime.toISOString()}");
        const now = new Date();
        const diff = Math.floor((now - startTime) / 1000);
        
        const hours = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;
        
        document.getElementById('uptime').textContent = \`\${hours}:\${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
      }
      
      // تحديث البيانات كل 10 ثوانٍ
      function updateStats() {
        fetch('/api/stats')
          .then(response => response.json())
          .then(data => {
            document.getElementById('totalUsers').textContent = data.totalUsers;
            document.getElementById('totalConversions').textContent = data.totalConversions;
            document.getElementById('totalImages').textContent = data.totalImagesProcessed;
            
            // تحديث قائمة التحويلات
            const conversionsList = document.getElementById('conversionsList');
            if (data.recentConversions.length > 0) {
              let html = '<h3 style="margin-bottom: 1rem; color: var(--dark);">آخر التحويلات</h3>';
              data.recentConversions.forEach(conv => {
                const date = new Date(conv.timestamp).toLocaleString('ar-SA');
                html += \`
                  <div class="conversion-item">
                    <div class="conversion-info">
                      <h4>\${conv.username}</h4>
                      <p>\${date}</p>
                    </div>
                    <div class="conversion-images">\${conv.imagesCount} صورة</div>
                  </div>
                \`;
              });
              conversionsList.innerHTML = html;
            }
          })
          .catch(error => console.error('Error fetching stats:', error));
      }
      
      // تحديث الوقت المنقضي كل ثانية
      setInterval(updateUptime, 1000);
      updateUptime();
      
      // تحديث الإحصائيات كل 10 ثوانٍ
      setInterval(updateStats, 10000);
      updateStats();
    </script>
  </body>
  </html>
  `;
  
  res.send(html);
});

// نقطة نهاية API للإحصائيات
app.get('/api/stats', (req, res) => {
  res.json({
    ...botStats,
    activeUsersCount: botStats.activeUsers.size,
    recentConversions: botStats.recentConversions.slice(0, 5)
  });
});

// تشغيل الخادم
app.listen(PORT, () => {
  console.log(`✅ خادم الويب يعمل على http://localhost:${PORT}`);
});

// معالجة إيقاف التطبيق
process.once('SIGINT', () => {
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
});
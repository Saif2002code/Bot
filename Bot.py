import os
import shutil
import logging
import asyncio
from datetime import datetime
from collections import defaultdict
from threading import Thread
from flask import Flask
from PIL import Image
from PyPDF2 import PdfMerger
from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters
)

# ==============================
# 1. إعدادات السيرفر الوهمي (Flask)
# ==============================
app = Flask('')

@app.route('/')
def home():
    return "Bot is running 24/7!"

def run_http():
    # Render يتوقع استجابة على المنفذ الافتراضي
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)

def keep_alive():
    t = Thread(target=run_http)
    t.start()

# ==============================
# 2. إعدادات البوت والبيانات
# ==============================
# ملاحظة: غير التوكن من BotFather إذا تم كشفه
TOKEN = "1822362552:AAGVHEuOIxUPlvXy7ptp8ms3gB-q6hBBtJs"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

user_data = defaultdict(lambda: {
    "images": [],
    "pdfs": [],
    "last_activity": datetime.now()
})

# ==============================
# 3. الدوال المساعدة (Helper Functions)
# ==============================
def init_user(uid):
    user_data[uid]["last_activity"] = datetime.now()
    return user_data[uid]

async def cleanup_user_files(uid):
    try:
        folder = f"user_{uid}"
        if os.path.exists(folder):
            shutil.rmtree(folder, ignore_errors=True)
        if uid in user_data:
            user_data[uid]["images"] = []
            user_data[uid]["pdfs"] = []
    except Exception as e:
        logger.error(f"Cleanup error: {e}")

async def cleanup_memory():
    while True:
        try:
            now = datetime.now()
            to_delete = []
            for uid, data in list(user_data.items()):
                if (now - data["last_activity"]).total_seconds() > 3600:
                    await cleanup_user_files(uid)
                    to_delete.append(uid)
            for uid in to_delete:
                del user_data[uid]
            await asyncio.sleep(300)
        except Exception as e:
            logger.error(f"Memory cleanup error: {e}")

def images_to_pdf(image_paths, output_pdf):
    images = []
    for path in image_paths:
        if os.path.exists(path):
            img = Image.open(path).convert("RGB")
            images.append(img)
    if images:
        images[0].save(output_pdf, save_all=True, append_images=images[1:])
        return True
    return False

def merge_pdfs(pdf_paths, output_pdf):
    merger = PdfMerger()
    for pdf in pdf_paths:
        if os.path.exists(pdf):
            merger.append(pdf)
    merger.write(output_pdf)
    merger.close()

# ==============================
# 4. أوامر ومعالجات البوت (Handlers)
# ==============================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    init_user(uid)
    welcome_text = """
🎯 **بوت تحويل الصور ودمج PDF**

📸 ارسل الصور ثم اكتب /pdf لتحويلها.
📄 ارسل ملفات PDF ثم اكتب /merge لدمجها.
🧹 اكتب /clear لمسح بياناتك.
"""
    await update.message.reply_text(welcome_text, parse_mode="Markdown")

async def handle_image(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = init_user(uid)
    photo = update.message.photo[-1]
    folder = f"user_{uid}"
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{photo.file_id}.jpg")
    
    file = await photo.get_file()
    await file.download_to_drive(path)
    data["images"].append(path)
    await update.message.reply_text(f"✅ تم حفظ الصورة {len(data['images'])}. ارسل المزيد أو اكتب /pdf")

async def handle_pdf(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = init_user(uid)
    doc = update.message.document
    if not doc.file_name.lower().endswith(".pdf"): return
    
    folder = f"user_{uid}"
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, doc.file_name)
    
    file = await doc.get_file()
    await file.download_to_drive(path)
    data["pdfs"].append(path)
    await update.message.reply_text(f"✅ تم حفظ PDF {len(data['pdfs'])}. ارسل المزيد أو اكتب /merge")

async def generate_pdf(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = user_data[uid]
    if not data["images"]:
        await update.message.reply_text("❌ لم ترسل صوراً بعد!")
        return
    
    output = f"user_{uid}/converted.pdf"
    images_to_pdf(data["images"], output)
    with open(output, "rb") as f:
        await update.message.reply_document(document=f, filename="converted.pdf")
    await cleanup_user_files(uid)

async def merge_files(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = user_data[uid]
    if len(data["pdfs"]) < 2:
        await update.message.reply_text("❌ ارسل ملفين على الأقل للدمج.")
        return
    
    output = f"user_{uid}/merged.pdf"
    merge_pdfs(data["pdfs"], output)
    with open(output, "rb") as f:
        await update.message.reply_document(document=f, filename="merged.pdf")
    await cleanup_user_files(uid)

async def clear(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await cleanup_user_files(update.effective_user.id)
    await update.message.reply_text("✅ تم مسح جميع ملفاتك.")

# ==============================
# 5. تشغيل البوت (Main)
# ==============================
def main():
    # تشغيل السيرفر لضمان بقائه حياً على Render
    keep_alive()
    
    # بناء التطبيق
    application = ApplicationBuilder().token(TOKEN).build()
    
    # تسجيل الأوامر
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("pdf", generate_pdf))
    application.add_handler(CommandHandler("merge", merge_files))
    application.add_handler(CommandHandler("clear", clear))
    application.add_handler(MessageHandler(filters.PHOTO, handle_image))
    application.add_handler(MessageHandler(filters.Document.PDF, handle_pdf))
    
    # تشغيل التنظيف في الخلفية
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(cleanup_memory())
    except:
        pass
        
    print("🤖 Bot is running...")
    application.run_polling()

if __name__ == "__main__":
    main()
📸 **تحويل الصور إلى PDF:**
• أرسل الصور (واحدة أو أكثر)
• اكتب /pdf لتحويلها إلى ملف PDF واحد

📄 **دمج ملفات PDF:**
• أرسل ملفات PDF (واحدة أو أكثر)
• اكتب /merge لدمجها في ملف واحد

🔄 **ترتيب الملفات:**
• يتم معالجة الملفات حسب ترتيب إرسالها

🧹 **تنظيف البيانات:**
• /clear لمسح جميع الملفات المخزنة

⏱️ **معلومة:** 
• البيانات تمسح تلقائيًا بعد ساعة من عدم النشاط
• الملفات تمسح بعد الإرسال مباشرة

📌 **ملاحظات:**
• دعم الصور: JPG, PNG, WebP
• أقصى حجم للصورة: 20MB
• أقصى حجم لملف PDF: 50MB
"""
    await update.message.reply_text(welcome_text, parse_mode="Markdown")

# ==============================
# استقبال الصور
# ==============================
async def handle_image(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = init_user(uid)
    
    try:
        photo = update.message.photo[-1]
        file = await photo.get_file()
        
        # التحقق من الحجم
        if file.file_size > 20 * 1024 * 1024:  # 20MB
            await update.message.reply_text("❌ حجم الصورة كبير جداً (الحد الأقصى 20MB)")
            return
        
        folder = f"user_{uid}"
        os.makedirs(folder, exist_ok=True)
        
        path = os.path.join(folder, f"{photo.file_id}.jpg")
        await file.download_to_drive(path)
        
        data["images"].append(path)
        
        count = len(data["images"])
        await update.message.reply_text(f"✅ تم حفظ الصورة ({count})\n📄 اكتب /pdf لتحويلها")
        
    except Exception as e:
        logger.error(f"Image handle error: {e}")
        await update.message.reply_text("❌ حدث خطأ في حفظ الصورة")

# ==============================
# استقبال ملفات PDF
# ==============================
async def handle_pdf(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = init_user(uid)
    
    try:
        doc = update.message.document
        
        if not doc.file_name.lower().endswith(".pdf"):
            await update.message.reply_text("❌ الملف ليس بصيغة PDF")
            return
        
        # التحقق من الحجم
        if doc.file_size > 50 * 1024 * 1024:  # 50MB
            await update.message.reply_text("❌ حجم الملف كبير جداً (الحد الأقصى 50MB)")
            return
        
        file = await doc.get_file()
        
        folder = f"user_{uid}"
        os.makedirs(folder, exist_ok=True)
        
        path = os.path.join(folder, doc.file_name)
        await file.download_to_drive(path)
        
        data["pdfs"].append(path)
        
        count = len(data["pdfs"])
        await update.message.reply_text(f"✅ تم حفظ ملف PDF ({count})\n🔄 اكتب /merge لدمجها")
        
    except Exception as e:
        logger.error(f"PDF handle error: {e}")
        await update.message.reply_text("❌ حدث خطأ في حفظ الملف")

# ==============================
# أمر تحويل الصور إلى PDF
# ==============================
async def generate_pdf(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = init_user(uid)
    
    if not data["images"]:
        await update.message.reply_text("❌ لم ترسل أي صور بعد\n📸 أرسل الصور أولاً")
        return
    
    folder = f"user_{uid}"
    output = os.path.join(
        folder,
        f"images_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    )
    
    msg = await update.message.reply_text("⏳ جاري تحويل الصور إلى PDF...")
    
    try:
        images_to_pdf(data["images"], output)
        
        with open(output, "rb") as f:
            await update.message.reply_document(
                document=f,
                caption="✅ تم تحويل الصور إلى PDF بنجاح",
                filename=f"images_{datetime.now().strftime('%Y%m%d')}.pdf"
            )
        
        # تنظيف بعد الإرسال
        await cleanup_user_files(uid)
        await msg.delete()
        
    except Exception as e:
        logger.error(f"Generate PDF error: {e}")
        await update.message.reply_text(f"❌ خطأ في التحويل: {str(e)[:100]}")
        await msg.delete()

# ==============================
# أمر دمج ملفات PDF
# ==============================
async def merge_files(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = init_user(uid)
    
    if len(data["pdfs"]) < 2:
        await update.message.reply_text("❌ تحتاج إلى إرسال ملفين PDF على الأقل\n📄 أرسل ملفات PDF أولاً")
        return
    
    folder = f"user_{uid}"
    output = os.path.join(
        folder,
        f"merged_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    )
    
    msg = await update.message.reply_text("⏳ جاري دمج ملفات PDF...")
    
    try:
        merge_pdfs(data["pdfs"], output)
        
        with open(output, "rb") as f:
            await update.message.reply_document(
                document=f,
                caption=f"✅ تم دمج {len(data['pdfs'])} ملفات بنجاح",
                filename=f"merged_{datetime.now().strftime('%Y%m%d')}.pdf"
            )
        
        # تنظيف بعد الإرسال
        await cleanup_user_files(uid)
        await msg.delete()
        
    except Exception as e:
        logger.error(f"Merge PDFs error: {e}")
        await update.message.reply_text(f"❌ خطأ في الدمج: {str(e)[:100]}")
        await msg.delete()

# ==============================
# تنظيف البيانات
# ==============================
async def clear(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    await cleanup_user_files(uid)
    await update.message.reply_text("✅ تم تنظيف جميع الملفات والبيانات")

# ==============================
# إظهار الحالة
# ==============================
async def status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    data = user_data.get(uid, {})
    
    images_count = len(data.get("images", []))
    pdfs_count = len(data.get("pdfs", []))
    
    status_text = f"""
📊 **حالتك الحالية:**

📸 الصور المخزنة: {images_count}
📄 ملفات PDF المخزنة: {pdfs_count}

{'📝 ملاحظة: أرسل /clear لتنظيف البيانات' if (images_count + pdfs_count) > 0 else '📭 لا توجد ملفات مخزنة'}
"""
    await update.message.reply_text(status_text, parse_mode="Markdown")

# ==============================
# تشغيل البوت
# ==============================
def main():
    app = ApplicationBuilder().token(TOKEN).build()
    
    # تسجيل المعالجات
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("pdf", generate_pdf))
    app.add_handler(CommandHandler("merge", merge_files))
    app.add_handler(CommandHandler("clear", clear))
    app.add_handler(CommandHandler("status", status))
    
    app.add_handler(MessageHandler(filters.PHOTO, handle_image))
    app.add_handler(MessageHandler(filters.Document.PDF, handle_pdf))
    
    # بدء تنظيف الذاكرة في الخلفية
    loop = asyncio.get_event_loop()
    loop.create_task(cleanup_memory())
    
    print("🤖 البوت يعمل...")
    logger.info("Bot started successfully")
    
    app.run_polling()

if __name__ == "__main__":
    main()

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudinary設定
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'y-share-temp',
        resource_type: 'auto', 
        public_id: (req, file) => file.originalname.split('.')[0] + '-' + Date.now(),
    },
});
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// ■ 重要な変更点: ファイル情報を保存するメモリ上のデータベース
// 構造: { "123456": { url: "...", name: "...", expiry: ... } }
let fileDatabase = {};

// 6桁のランダムな数字を生成する関数
function generateCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (fileDatabase[code]); // 重複チェック
    return code;
}

// トップページ（送信・受信画面）
app.get('/', (req, res) => {
    res.render('index', { generatedCode: null, error: null });
});

// 送信（アップロード）処理
app.post('/send', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.render('index', { generatedCode: null, error: 'ファイルを選択してください' });
    }

    const code = generateCode();

    // 【修正1】文字化け対策：ファイル名をUTF-8に変換して直す
    let originalName = req.file.originalname;
    try {
        // Latin1(ISO-8859-1)として誤認識されたものをバイナリに戻し、UTF-8として読み直す
        originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch (e) {
        console.log("文字コード変換エラー:", e);
    }

    // データベースに登録
    fileDatabase[code] = {
        url: req.file.path,
        name: originalName, // 修正済みの名前を保存
        timer: setTimeout(() => {
            delete fileDatabase[code];
            console.log(`Code ${code} expired.`);
        }, 10 * 60 * 1000)
    };

    // 修正済みの名前で画面に表示
    res.render('index', { generatedCode: code, error: null, filename: originalName });
});

// 受信（ダウンロード）処理
app.post('/receive', (req, res) => {
    const code = req.body.code;
    const fileData = fileDatabase[code];

    if (fileData) {
        // 【修正2】ダウンロード時に正しい日本語ファイル名になるようにURLを加工
        // CloudinaryのURLの "/upload/" の後ろに "fl_attachment:(ファイル名)/" を挿入する
        
        let downloadUrl = fileData.url;
        
        // ファイル名をURLエンコード（日本語対応）
        const encodedName = encodeURIComponent(fileData.name);
        
        // URLを加工して「強制ダウンロード」かつ「ファイル名指定」のフラグを追加
        // 元: .../upload/v12345/...
        // 新: .../upload/fl_attachment:エンコードされた名前/v12345/...
        downloadUrl = downloadUrl.replace('/upload/', `/upload/fl_attachment:${encodedName}/`);

        res.redirect(downloadUrl);
    } else {
        res.render('index', { generatedCode: null, error: '無効なコード、または期限切れです。' });
    }
});

app.listen(PORT, () => {
    console.log(`Y-Share server running on port ${PORT}`);
});
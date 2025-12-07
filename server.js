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

    // データベースに登録
    fileDatabase[code] = {
        url: req.file.path,
        name: req.file.originalname,
        timer: setTimeout(() => {
            // 10分後にデータを削除（メモリ解放）
            // ※Cloudinary上の実ファイルは残りますが、アクセス手段がなくなります
            delete fileDatabase[code];
            console.log(`Code ${code} expired.`);
        }, 10 * 60 * 1000) // 10分
    };

    // ユーザーにコードを表示
    res.render('index', { generatedCode: code, error: null, filename: req.file.originalname });
});

// 受信（ダウンロード）処理
app.post('/receive', (req, res) => {
    const code = req.body.code;
    const fileData = fileDatabase[code];

    if (fileData) {
        // CloudinaryのURLへリダイレクトしてダウンロード開始
        res.redirect(fileData.url);
    } else {
        res.render('index', { generatedCode: null, error: '無効なコード、または期限切れです。' });
    }
});

app.listen(PORT, () => {
    console.log(`Y-Share server running on port ${PORT}`);
});
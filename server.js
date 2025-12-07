require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
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
        // ↓【修正】日本語ファイル名を使わず、安全なIDを生成する
        public_id: (req, file) => 'upload-' + Date.now(), 
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
app.post('/receive', async (req, res) => { // ← async を追加！
    const code = req.body.code;
    const fileData = fileDatabase[code];

    if (fileData) {
        try {
            // Cloudinaryからファイルデータを取得
            const response = await axios({
                method: 'GET',
                url: fileData.url,
                responseType: 'stream' // ストリーム形式（データそのまま）で取得
            });

            // ブラウザに対して「これはダウンロードファイルですよ」と伝えるヘッダー設定
            // 日本語ファイル名が正しく扱われる形式（RFC 5987）で指定
            const encodedName = encodeURIComponent(fileData.name);
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
            
            // ファイルの種類（MIMEタイプ）を中継
            res.setHeader('Content-Type', response.headers['content-type']);

            // データをユーザーへ流し込む
            response.data.pipe(res);

        } catch (error) {
            console.error('Download error:', error);
            res.render('index', { generatedCode: null, error: 'ファイルの取得に失敗しました。' });
        }
    } else {
        res.render('index', { generatedCode: null, error: '無効なコード、または期限切れです。' });
    }
});

app.listen(PORT, () => {
    console.log(`Y-Share server running on port ${PORT}`);
});
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const axios = require('axios');
const archiver = require('archiver'); // ZIP圧縮用

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
        public_id: (req, file) => 'upload-' + Date.now() + '-' + Math.round(Math.random() * 1000),
    },
});

// 最大10ファイルまでアップロード可能に設定
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// データ保存用（ { code: [file1, file2, ...] } の形式に変更）
let fileDatabase = {};

function generateCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (fileDatabase[code]);
    return code;
}

// 文字コード修正関数
function fixFileName(name) {
    try {
        return Buffer.from(name, 'latin1').toString('utf8');
    } catch (e) {
        return name;
    }
}

app.get('/', (req, res) => {
    res.render('index', { generatedCode: null, error: null, fileCount: 0 });
});

// 送信処理（複数ファイル対応）
// "files" はHTMLのinputタグのname属性です。最大20ファイルまで許可。
app.post('/send', upload.array('files', 20), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.render('index', { generatedCode: null, error: 'ファイルが選択されていません', fileCount: 0 });
    }

    const code = generateCode();

    // アップロードされた全ファイルの情報を整形して保存
    const filesData = req.files.map(file => ({
        url: file.path,
        name: fixFileName(file.originalname),
        mimetype: file.mimetype
    }));

    fileDatabase[code] = {
        files: filesData,
        timer: setTimeout(() => {
            delete fileDatabase[code];
            console.log(`Code ${code} expired.`);
        }, 10 * 60 * 1000)
    };

    // 1つの場合と複数の場合でメッセージを変えるための情報
    const displayFileName = filesData.length === 1 
        ? filesData[0].name 
        : `${filesData.length}個のファイル`;

    res.render('index', { 
        generatedCode: code, 
        error: null, 
        filename: displayFileName,
        fileCount: filesData.length 
    });
});

// 受信処理（ZIP圧縮対応）
app.post('/receive', async (req, res) => {
    const code = req.body.code;
    const data = fileDatabase[code];

    if (!data) {
        return res.render('index', { generatedCode: null, error: '無効なコード、または期限切れです。', fileCount: 0 });
    }

    try {
        const files = data.files;

        // 【ケース1】ファイルが1つだけの場合 -> そのままダウンロード
        if (files.length === 1) {
            const file = files[0];
            const response = await axios({
                method: 'GET',
                url: file.url,
                responseType: 'stream'
            });

            const encodedName = encodeURIComponent(file.name);
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
            res.setHeader('Content-Type', response.headers['content-type']);
            return response.data.pipe(res);
        }

        // 【ケース2】ファイルが複数の場合 -> ZIP圧縮してダウンロード
        // ZIPファイル名を作成（例: y-share-123456.zip）
        const zipName = `y-share-${code}.zip`;
        res.setHeader('Content-Disposition', `attachment; filename=${zipName}`);
        res.setHeader('Content-Type', 'application/zip');

        // ZIP作成ライブラリのセットアップ
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        // エラーハンドリング
        archive.on('error', (err) => { throw err; });
        archive.pipe(res);

        // 各ファイルをCloudinaryから取得してZIPに追加
        for (const file of files) {
            const response = await axios({
                method: 'GET',
                url: file.url,
                responseType: 'stream'
            });
            // ZIP内にファイルを追加
            archive.append(response.data, { name: file.name });
        }

        // 圧縮完了（これでダウンロードが終了する）
        archive.finalize();

    } catch (error) {
        console.error('Download error:', error);
        // ストリーム開始後にエラーが出た場合はヘッダー変更できないため、コンソール出力のみ
        if (!res.headersSent) {
             res.render('index', { generatedCode: null, error: 'ダウンロード中にエラーが発生しました。', fileCount: 0 });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Y-Share server running on port ${PORT}`);
});
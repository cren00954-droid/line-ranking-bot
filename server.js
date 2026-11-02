const express = require('express');
const mongoose = require('mongoose');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// 環境変数から設定を読み込む
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// MongoDB接続
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// 発言データのスキーマ定義
const messageSchema = new mongoose.Schema({
  groupId: String,
  userId: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// 1. LINEからのWebhookを受け取るエンドポイント
app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text;
      const replyToken = event.replyToken;
      const groupId = event.source.groupId || event.source.roomId;
      const userId = event.source.userId;

      // グループ内の発言でなければスルー
      if (!groupId) continue;

      if (text === '/ランキング') {
        // 全期間総合ランキングを計算して返信
        const rankingText = await getRankingText(groupId, 'all');
        await replyMessage(replyToken, rankingText);
      } else {
        // 通常の発言をデータベースに保存
        await Message.create({ groupId, userId });
      }
    }
  }
  res.sendStatus(200);
});

// 2. 毎日18:00の自動配信を受け取るエンドポイント（cron-job.orgから呼び出す）
app.get('/cron/daily', async (req, res) => {
  // ※簡易的な実装として、直近24時間（前日18:00〜当日18:00）を集計してプッシュ送信する処理をここに記述
  // グループIDごとに集計して、LINE Messaging APIの /v2/bot/message/push で送信します
  res.send('Daily ranking processed');
});

// ランキングを集計する関数
async function getRankingText(groupId, type) {
  let query = { groupId };
  if (type === 'daily') {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    query.createdAt = { $gte: twentyFourHoursAgo };
  }

  const ranking = await Message.aggregate([
    { $match: query },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]);

  if (ranking.length === 0) return 'まだ発言データがありません。';

  let text = '🏆 【全期間 発言数ランキング】 🏆\n';
  ranking.forEach((item, index) => {
    // ※本来はLINEのプロフィールAPIでユーザー名を取得するとよりリッチになります
    text += `${index + 1位}: ユーザーID... (${item.count}回)\n`;
  });
  return text.trim();
}

// LINEに返信する関数
async function replyMessage(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    })
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

# Telegram YouTube MP3 Bot

協助將 YouTube 影片轉換為 MP3 的 Telegram Bot

## 這能做什麼？

貼上 youtube 影片網址，等待片刻，Bot 會將 MP3 傳送給您！

## How To 架

請準備一份 config.json 參考 config.example.json 並放置於專案根目錄

- node 環境（個人是 v12）
- 需要安裝 `ffmpeg`

目前採取 polling 方式

``` sh
# mac
brew install ffmpeg
# ubuntu
apt install ffmpeg

npm i
npm run start
```

就可以架起屬於你的轉換工ㄌ！

## License

**The MIT License (MIT)**

Copyright © 2020 DevilTea
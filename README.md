# BakonRecon

## Telegram scraping

This app now scrapes ABA payment notifications from Telegram text messages and stores them in `bank_database.json`.

### Configure `.env`

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=-5298243828
PORT=3000
```

### Important Telegram setup

- Add the bot to the target group or supergroup.
- Disable BotFather privacy mode so the bot can read group messages.
- Restart the server after changing `.env`.

### Supported sample formats

- `៛100 paid by LY LAISRUN (*964) on Jul 04, 02:14 PM via ABA PAY at KIM PUTDARARITH. Trx. ID: 178314927151090, APV: 444368.`
- `៛200 paid by ROEURN PHANNET (*943) on Jul 04, 02:14 PM via ABA PAY at KIM PUTDARARITH. Trx. ID: 178314929484377, APV: 275770.`
- `៛100 paid by Hoa Ratha (*221) on Jul 04, 02:18 PM via ABA KHQR (ACLEDA Bank Plc.) at KIM PUTDARARITH. Trx. ID: 178314949354277, APV: 380602.`

### Run the parser test

```bash
npm test
```

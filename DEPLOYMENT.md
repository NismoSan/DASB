# DASB — Debian VPS Deployment (PM2)

## 1. Install Node.js 18+

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs build-essential
```

## 2. Install PM2

```bash
sudo npm install -g pm2
```

## 3. Upload the Project

SCP from your local machine, then SSH in:

```bash
scp -r ./da.js-master user@your-vps-ip:~/dasb
ssh user@your-vps-ip
cd ~/dasb
```

## 4. Install & Build

```bash
npm install
npm run build
```

## 5. Set Up .env

```bash
nano .env
```

```
OPENAI_API_KEY=sk-proj-your-key-here
```

Skip if you don't use Chat Games.

## 6. Open the Firewall

```bash
sudo ufw allow 4000/tcp
```

## 7. Start with PM2

```bash
pm2 start panel.js --name dasb
```

Open `http://your-vps-ip:4000` — configure bots from the web panel.

## 8. Auto-Start on Reboot

```bash
pm2 save
pm2 startup
```

Run the command it prints (it will look like `sudo env PATH=... pm2 startup systemd ...`).

## 9. Useful Commands

| Task | Command |
|---|---|
| Status | `pm2 status` |
| Logs | `pm2 logs dasb` |
| Restart | `pm2 restart dasb` |
| Stop | `pm2 stop dasb` |
| Monitor | `pm2 monit` |

## 10. Updating

```bash
cd ~/dasb
git pull
npm install
npm run build
pm2 restart dasb
```

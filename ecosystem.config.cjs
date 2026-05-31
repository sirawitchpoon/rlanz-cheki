// PM2 process config. Deploy on the VPS with:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   (so it survives reboots)
module.exports = {
  apps: [
    {
      name: 'cheki',
      script: 'src/index.js',
      // cwd defaults to the directory of this file; override if you run pm2 from elsewhere.
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true, // prefix logs with timestamps
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

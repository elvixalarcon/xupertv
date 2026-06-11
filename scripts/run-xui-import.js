const { importStreamsFromXuiAdmin } = require('../server/services/xuiSync');

importStreamsFromXuiAdmin({ download: true })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });

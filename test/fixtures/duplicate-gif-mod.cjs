// test/fixtures/duplicate-gif-mod.cjs
// 实测重名 gif mod —— 用户本机 webapi 下载验证用（非单测数据，node --test 不拾取此文件）
//
//   用法：本机启动项目（node server/boot.cjs）→ POST /api/download 下载此 mod
//   → 验证两个重名 giphy.gif 大小后缀防覆盖：
//   预期磁盘文件 giphy_4.05MB.gif + giphy_4.80MB.gif 共存（不互相覆盖）
//
//   来源：SA6400 真实已下载 mod（绝区零代理人 Alice，modId 615808），
//   其 description.html 的 obj.gifs 里有两个 file:"giphy.gif"（不同 giphy media URL → 不同大小）。
module.exports = {
  modUrl: "https://gamebanana.com/mods/615808",
  modId: "615808",
  name: "Sexy Alice: Scarlet Passion",
  game: "Zenless Zone Zero",
  // 两个重名 gif（同名 giphy.gif，不同 URL/大小）→ 防覆盖后应为不同 localFile
  duplicateGifs: [
    {
      file: "giphy.gif",
      expectedLocalFile: "giphy_4.05MB.gif",
      size: 4243871,
      url: "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExMGc4YTV1cDNoaXc5dXRobzN2NHdqZjM0NjZua21iczZxMmh4M2RoeiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Bvt6FyLrtZCtwIx2e0/giphy.gif",
    },
    {
      file: "giphy.gif",
      expectedLocalFile: "giphy_4.80MB.gif",
      size: 5035173,
      url: "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExaGU2YXRnMHB5MnE1MmxqM290cGp6dnpxaTQ5NnZtZmQxOTZiMHZkdyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ujsUXeCLawmZQQ4N2X/giphy.gif",
    },
  ],
};

# Meem 浏览器扩展

这是 Meem 的 Chrome 扩展。

职责很收敛：

- 显示本地连接状态
- 显示当前浏览器标签页状态
- 保存本地 bridge 的 host / port
- 接收并执行来自本地 Meem Client 的浏览器操作命令

## 目录说明

- [`manifest.json`](manifest.json)
- [`background.js`](background.js)
- [`popup.html`](popup.html)
- [`popup.js`](popup.js)
- [`icon.svg`](icon.svg)
- [`icon-16.png`](icon-16.png)
- [`icon-32.png`](icon-32.png)
- [`icon-48.png`](icon-48.png)
- [`icon-128.png`](icon-128.png)

## 图标说明

仓库里提供了一份源图标 [`icon.svg`](icon.svg)，并已导出为 16 / 32 / 48 / 128 四个 `png` 尺寸，当前 manifest 已直接使用这些 `png`。

## 加载方式

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 点击 `Load unpacked`
4. 选择 `browser/extension`

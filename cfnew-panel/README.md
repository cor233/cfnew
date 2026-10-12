# CFnew 独立面板

Worker 负责代理和 KV 配置。这个服务负责原控制台、优选操作和订阅转换。代理流量直接到 Worker，不经过面板服务器。

## 部署

把仓库根目录的 `明文源吗` 部署到 Cloudflare Worker，设置 `u` 为你的 UUID。已有 KV 继续绑定为 `C` 或 `c`，原 `c` / `c_ver` 数据可沿用。兼容日期仍用 `2026-01-20`。

在独立服务器上安装 Node.js 22 或更新版本，运行：

```bash
cd cfnew-panel
node server.mjs
```

默认监听 `127.0.0.1:3100`，在 Nginx / Caddy 中通过 HTTPS 反代。页面填写 **Worker 域名和 UUID** 即可连接。

也可以使用 Docker：

```bash
cd cfnew-panel
docker compose up -d --build
```

Nginx 的主要配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
    proxy_buffering off;
}
```

服务无需安装 npm 依赖，不存 UUID 或配置到服务器。勾选“记住节点”时，节点只保存到该浏览器。Nginx 访问日志应关闭，或使用不含查询参数的 `$uri` 格式，避免记录订阅中的 UUID。

## 订阅与配置

- 页面：`https://面板域名/panel?host=Worker域名&uuid=UUID`
- 自动识别订阅：`https://面板域名/sub?host=Worker域名&uuid=UUID`
- 指定客户端：在订阅 URL 后加 `&target=clash`，也支持 `singbox`、`surge`、`loon`、`quanx`、`v2ray` 和 `base64`。
- 家宽链式：开启 `jk` 后使用 `&target=vg`，沿用 main 的 VPNGate 家宽功能。
- 保存配置和优选 API 继续请求 Worker 的 `/{UUID}/api/config` / `/{UUID}/api/preferred-ips`。自定义路径可以作为 API 别名，UUID 入口始终可用。

客户端更新订阅时，独立服务会重新读取 Worker 的有效配置，所以改完 KV 无需重新复制订阅 URL。节点的 SNI / Host 和实际代理入口始终指向 Worker。

未绑定 KV 时仍能生成订阅，但无法通过页面保存配置；通过 Worker 环境变量修改即可。已有客户端使用的 Worker `/sub` 地址需要换为独立服务上的订阅地址。

WS 两协议、XHTTP、SOCKS5 / HTTP / HTTPS 出站、`qj` 三种模式、`p/wk/rm/s` 连接参数、ECH、ALPN、IPv6 与原格式规则均保留。

健康检查：`GET /health`。配置读取超时或资源源站故障时，订阅返回错误状态，客户端可保留上一份配置。

## 检查

在源码仓库的 `cfnew-panel` 目录运行：

```bash
npm test
```

`CFNEW_ALLOW_PRIVATE=yes` 只供本地或隔离测试时接入私网 Worker；正常部署不设置。

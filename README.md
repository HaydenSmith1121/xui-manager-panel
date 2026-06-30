# X-UI Manager Panel

一个轻量的 3X-UI/X-UI 聚合订阅管理面板。管理员在后台配置套餐、X-UI 面板和 VLESS 节点模板；用户注册并通过审核后，系统会自动在对应 X-UI 入站里创建该用户的独立 VLESS client，并生成 Clash 订阅链接。

订阅响应会带 `Subscription-Userinfo`，Clash Verge 可以显示总量、已用、剩余和到期时间。

## 功能

- 用户注册、登录、套餐选择、等待管理员审核
- 套餐配置：总量、有效期、允许节点标签、是否需要审核
- 多 X-UI 面板配置：面板地址、账号、密码、TLS 校验
- VLESS 托管节点：注册后自动给用户创建独立 client
- 静态节点：兼容固定分享链接聚合
- 倍率计费：节点可配置 1 倍、3 倍、0.5 倍等
- 动态用量同步：读取 X-UI `clientStats` 并按节点倍率写入账本
- 到期或超量后自动停用用户在 X-UI 中的 client
- Clash 订阅生成：`/sub/clash/<token>`
- 后台操作：面板测试、拉取入站、用户开通重试、用户对账、同步间隔设置

## 重要说明

不要把服务器密码、X-UI 面板密码写进 GitHub。部署后在网页后台填写面板信息，密码只保存在服务器本机 SQLite 数据库里。

当前稳定目标是 VLESS 托管节点。Trojan、VMess 等协议可以先用静态节点方式聚合，后续再扩展自动开通。

动态统计依赖 X-UI 的独立 client 统计。托管模式会自动给每个用户、每个节点创建独立 VLESS client；静态模式如果多个用户共用同一个链接，无法按用户分别统计真实用量。

## 一键部署

在服务器 SSH 里执行：

```bash
export ADMIN_EMAIL='你的管理员邮箱'
export ADMIN_PASSWORD='你的管理员密码'
bash <(curl -fsSL https://raw.githubusercontent.com/HaydenSmith1121/xui-manager-panel/main/deploy/install.sh)
```

安装完成后打开：

```text
http://服务器IP:25888/
```

如果不设置 `ADMIN_PASSWORD`，脚本会随机生成管理员密码，并在安装输出里显示。

## 后台配置教程

1. 用安装时设置的管理员邮箱和密码登录。
2. 打开“配置”，创建套餐，例如 `1000G 月付`、总量 `1000`、有效天数 `30`。
3. 在“配置”里添加 X-UI 面板。面板地址填写完整地址，例如 `https://你的域名:端口/随机路径/`。
4. 添加面板后，在面板列表点击“测试”，确认后台能登录这个 X-UI。
5. 点击面板列表里的“入站”，系统会拉取该面板入站并跳到“节点”页面。
6. 在“节点”页面选择“托管：注册后自动写入 X-UI 客户端”。
7. `X-UI 入站 ID` 填 X-UI 入站列表里的 `ID`，只有一个入站时通常就是 `1`。
8. `分享链接` 粘贴这个入站生成的 VLESS 分享链接，作为模板。系统会替换其中的 UUID，给每个用户生成独立链接。
9. `倍率` 填 `1`、`3`、`0.5` 等；实际用 1GB，倍率 3 会按 3GB 计入套餐。
10. `标签` 用英文逗号分隔，例如 `us,premium`。套餐允许标签为空代表可用全部节点。
11. 多台服务器重复添加多个面板和多个托管节点即可。

## 用户开通流程

1. 用户打开网站注册，选择套餐。
2. 如果套餐需要审核，管理员到“后台”点击“通过”。
3. 审核通过后，系统会自动在所有符合套餐标签的托管节点里创建该用户的 VLESS client。
4. 如果某个面板临时失败，用户行点击“重试开通”。
5. 如果你修改了节点或面板配置，用户行点击“对账”，系统会补齐缺失的 client。
6. 用户登录后复制 Clash 订阅链接导入 Clash Verge。

## 同步和流量显示

进入“后台”，点击“同步 X-UI 用量”。系统会登录每个启用的 X-UI 面板，读取入站里的 `clientStats`，按节点倍率更新用户用量。

进入“配置”的“同步设置”，可以修改后台自动同步间隔，默认 `300` 秒，最小 `60` 秒，最大 `86400` 秒。

同步结果会影响订阅响应头：

```text
Subscription-Userinfo: upload=...; download=...; total=...; expire=...
```

Clash Verge 订阅卡片里的总量、已用、剩余、到期时间就是从这个响应头读取的。

## 测试教程

查看服务状态：

```bash
systemctl status xui-manager-panel --no-pager
```

测试网页：

```bash
curl -I http://127.0.0.1:25888/
```

测试公开套餐接口：

```bash
curl http://127.0.0.1:25888/api/plans
```

测试订阅链接：

```bash
curl -i "http://服务器IP:25888/sub/clash/用户token"
```

在后台测试 X-UI 面板：

1. 打开“配置”。
2. 找到面板列表。
3. 点击“测试”。
4. 页面提示 `面板连接正常：N 个入站` 就说明面板地址、账号、密码基本正确。

如果订阅导入 Clash 报错，先用 `curl -i` 看状态码；正常应该返回 `200` 和 YAML 内容。

## 查看日志

实时日志：

```bash
journalctl -u xui-manager-panel -f
```

最近 200 行：

```bash
journalctl -u xui-manager-panel -n 200 --no-pager
```

重启服务：

```bash
systemctl restart xui-manager-panel
```

查看是否监听端口：

```bash
ss -lntp | grep 25888
```

## 修改配置

运行端口、管理员种子账号、数据目录在：

```bash
nano /etc/xui-manager-panel/xui-manager.env
systemctl restart xui-manager-panel
```

数据库在：

```text
/opt/xui-manager-panel-data/app.db
```

备份数据库：

```bash
cp /opt/xui-manager-panel-data/app.db /root/xui-manager-panel-app.db.bak.$(date +%F-%H%M%S)
```

更新项目：

```bash
cd /opt/xui-manager-panel
git pull --ff-only
systemctl restart xui-manager-panel
```

## 重置管理员账号

如果忘记管理员密码，在服务器执行：

```bash
cd /opt/xui-manager-panel
python3 tools/reset_admin.py --email 'admin@admin.com' --password 'admin@admin.com'
systemctl restart xui-manager-panel
```

然后用新的邮箱和密码登录。

## 常见问题

### X-UI 入站 ID 填哪个？

填 X-UI 面板“入站”列表中的 `ID`。如果页面里只有一条入站且 ID 显示为 `1`，这里就填 `1`。

### 为什么 Clash 显示不了剩余流量？

先用下面命令测试订阅响应头：

```bash
curl -i "http://服务器IP:25888/sub/clash/用户token"
```

如果没有 `Subscription-Userinfo`，说明订阅链接不对或用户未激活。如果有响应头但用量不变，去后台点击“同步 X-UI 用量”，再看日志。

### 同步失败怎么查？

依次检查：

- 面板地址是否包含随机路径，并以 `/` 结尾
- 面板账号密码是否正确
- 服务器是否能访问该面板端口
- 节点是否绑定了正确的面板
- 节点 `X-UI 入站 ID` 是否正确
- 节点模板是否是有效 `vless://` 链接
- X-UI 入站是否启用

### 修改面板密码时为什么留空？

编辑已有面板时，密码框留空表示保留服务器里原来保存的密码；只有填写新密码时才会替换。

## 卸载

保留数据卸载程序：

```bash
systemctl stop xui-manager-panel
systemctl disable xui-manager-panel
rm -f /etc/systemd/system/xui-manager-panel.service
systemctl daemon-reload
rm -rf /opt/xui-manager-panel
```

彻底删除数据和配置：

```bash
rm -rf /opt/xui-manager-panel-data /etc/xui-manager-panel
```

## 本地开发测试

```bash
python -m unittest discover tests -v
python -m xui_manager.app
```

默认监听 `0.0.0.0:25888`，可以通过环境变量调整：

```bash
set LISTEN_PORT=8765
set XUI_MANAGER_DATA=%cd%\data
set ADMIN_EMAIL=admin@example.com
set ADMIN_PASSWORD=ChangeMe123
python -m xui_manager.app
```

# ArduiNodon・Codex ローカル連携 導入手順書

最終更新: 2026-07-14  
対象: Windows版Codexデスクトップアプリ、ローカルMCP、ArduiNodon UI v1.5相当

## 1. この手順書の範囲

この手順書は、利用者が自分で正当に入手したArduiNodonのHTMLを使い、CodexからローカルMCP経由で操作できる状態にするまでを説明する。

ノードンプログラミングの技法、はじプロの特殊仕様、検証結果、作成済みプログラムの解説は含めない。

## 2. 権利上の前提

この手順書はArduiNodon本体の配布、再配布、転載を行うものではない。

利用者は次を自分で確認し、自分の責任で作業すること。

- ArduiNodon本体の入手元と利用条件
- HTMLの複製、改変、利用の可否
- 著作権、商標その他の権利

第三者へ案内するときもArduiNodonのHTMLを同梱せず、各利用者が正規の方法で用意する。本書は特定の権利を許諾するものではない。

## 3. 連携構成

~~~text
Codexデスクトップアプリ
  ↓ MCP（標準入出力）
ArduiNodon-mcp-server.mjs
  ↓
ArduiNodon-engine.mjs
  ↓
利用者自身が用意した ArduiNodon-UI_v1-5.html
~~~

MCPサーバーとシミュレーションは利用者のPC内で動作する。MCPサーバー用のOpenAI APIキーは不要で、Codexは利用者自身のアカウントを使う。

## 4. 必要なもの

1. Windows 10または11
2. Codexデスクトップアプリ
3. 利用者自身のCodexアカウント
4. 利用者が正当に入手したArduiNodon HTML
5. Node.js実行環境
6. 次の連携コード

~~~text
ArduiNodon-engine.mjs
ArduiNodon-mcp-server.mjs
ArduiNodon-cli.mjs
~~~

連携コードはNode.jsの標準機能だけを使用しており、現状は `npm install` を必要としない。

## 5. フォルダを用意する

例として次のフォルダを使用する。

~~~text
C:\Tools\ArduiNodon
~~~

次の4ファイルを同じフォルダへ置く。

~~~text
C:\Tools\ArduiNodon\
├─ ArduiNodon-UI_v1-5.html
├─ ArduiNodon-engine.mjs
├─ ArduiNodon-mcp-server.mjs
└─ ArduiNodon-cli.mjs
~~~

HTMLの既定ファイル名は `ArduiNodon-UI_v1-5.html`。別名にする場合は、`ArduiNodon-engine.mjs`内の`DEFAULT_HTML`も変更する。

パスに日本語や空白が含まれていても利用できるが、設定では必ず引用符で囲む。

## 6. Node.jsを確認する

PowerShellで実行:

~~~powershell
Get-Command node
(Get-Command node).Source
~~~

見つかった絶対パスを後でCodex設定へ記載する。

### nodeが見つからない場合

方法は二つある。

1. 利用者自身でNode.jsを導入する
2. Codexに同梱されたNode.jsを使う

Codex同梱Node.jsは、環境によって次の場所に存在する。

~~~text
%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
~~~

確認:

~~~powershell
$node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Test-Path -LiteralPath $node
$node
~~~

`True`なら利用可能。ただしCodexの更新で場所が変わる可能性がある。

## 7. CLIで事前確認する

Codexへ登録する前に、HTMLと連携コードが起動できるか確認する。

~~~powershell
Set-Location -LiteralPath 'C:\Tools\ArduiNodon'
node .\ArduiNodon-cli.mjs --help
~~~

Node.jsを絶対パスで指定する場合:

~~~powershell
& 'C:\Program Files\nodejs\node.exe' '.\ArduiNodon-cli.mjs' --help
~~~

正常なら `ArduiNodon headless simulator` とオプション一覧が表示される。

### 最小動作確認

`smoke-test.ndnx`というファイルを作り、次を保存する。

~~~js
createConstantNodon(4,2,14);
createNumberObjectNodon(6,2,1,1,1,255,4294967295,255,4294967295,0,0,0,11,0,0,3,4,5,3,0);
createConnection(4,2,6,2,0,0);
~~~

実行:

~~~powershell
node .\ArduiNodon-cli.mjs --program '.\smoke-test.ndnx' --frames 2 --observe 6,2 --pretty
~~~

JSON内の `inputs` に14が表示されれば、HTMLとヘッドレスエンジンは動作している。

## 8. Codex設定をバックアップする

Codexのユーザー設定は通常、次の場所にある。

~~~text
%USERPROFILE%\.codex\config.toml
~~~

PowerShellでバックアップ:

~~~powershell
$config = Join-Path $env:USERPROFILE '.codex\config.toml'
Copy-Item -LiteralPath $config -Destination ($config + '.backup') -Force
~~~

ファイルがまだ存在しない場合は、`%USERPROFILE%\.codex`フォルダに`config.toml`を新規作成する。

## 9. MCPサーバーを登録する

`config.toml`の末尾へ次を追加する。パスは自分の環境に置き換える。

~~~toml
[mcp_servers.arduinodon]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\Tools\ArduiNodon\ArduiNodon-mcp-server.mjs']
startup_timeout_sec = 120

[mcp_servers.arduinodon.env]
ARDUINODON_SEED = '1'
~~~

Codex同梱Node.jsを使う場合は`command`を実在するパスへ変更する。

~~~toml
[mcp_servers.arduinodon]
command = 'C:\Users\利用者名\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
args = ['C:\Tools\ArduiNodon\ArduiNodon-mcp-server.mjs']
startup_timeout_sec = 120

[mcp_servers.arduinodon.env]
ARDUINODON_SEED = '1'
~~~

TOMLの単一引用符はWindowsパスをそのまま記述しやすい。`command`と`args`には必ず実在する絶対パスを指定する。

## 10. 任意のツール承認設定

信頼できるローカルファイルだけを扱い、毎回の確認を省略したい場合に限り追加する。

~~~toml
[mcp_servers.arduinodon.tools.get_nodon_catalog]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.load_nodon_program]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.run_nodon_tests]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.run_nodon_simulation]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.reset_nodon_simulation]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.read_nodon_state]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.read_nodon_graph]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.step_nodon_simulation]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.set_nodon_input]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.set_nodon_parameter]
approval_mode = "approve"

[mcp_servers.arduinodon.tools.export_nodon_program]
approval_mode = "approve"
~~~

不特定のHTMLやプログラムを扱う場合は自動承認せず、Codexが表示する確認を都度読む。

## 11. Codexを再起動する

1. `config.toml`を保存する
2. Codexデスクトップアプリを完全に終了する
3. Codexを起動し直す
4. 新しいタスクを開始する

既存タスクではMCPツール一覧が更新されない場合がある。

## 12. 接続を確認する

新しいタスクで次のように依頼する。

~~~text
ArduiNodonのMCPツールが使えるか確認して、
ノードンカタログからMapの定義を取得してください。
~~~

主に次のツールが認識されれば登録成功。

- `get_nodon_catalog`
- `load_nodon_program`
- `set_nodon_input`
- `set_nodon_parameter`
- `reset_nodon_simulation`
- `step_nodon_simulation`
- `run_nodon_simulation`
- `run_nodon_tests`
- `read_nodon_state`
- `read_nodon_graph`
- `export_nodon_program`

続いて最小動作確認:

~~~text
smoke-test.ndnxを読み込み、
2フレーム進めて6,2の入力が14になることを確認してください。
~~~

## 13. セキュリティ上の注意

1. MCPサーバーはローカルで動作する。
2. MCPの実行結果はCodexへ渡る。機密ファイルではCodexのデータ設定や組織ポリシーを確認する。
3. `load_nodon_program`は指定されたローカルファイルを読めるため、信頼できない指示で任意パスを読ませない。
4. エンジンはHTMLからJavaScriptを抽出してVM内で実行する。信頼できる入手元のHTMLだけを使う。
5. `config.toml`へAPIキーやパスワードを書かない。

## 14. トラブルシューティング

### nodeが認識されない

- `Get-Command node`で確認する
- Node.jsの絶対パスを`command`へ指定する
- PowerShellとCodexを再起動する

### CodexにArduiNodonツールが出ない

1. `config.toml`のセクション名を確認
2. `command`と`args`のファイルが存在するか確認
3. TOMLの引用符を確認
4. Codexを完全終了したか確認
5. 新しいタスクで確認

パス確認:

~~~powershell
Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe'
Test-Path -LiteralPath 'C:\Tools\ArduiNodon\ArduiNodon-mcp-server.mjs'
Test-Path -LiteralPath 'C:\Tools\ArduiNodon\ArduiNodon-UI_v1-5.html'
~~~

### Simulation state block not found

HTMLの内容またはバージョンがエンジンの想定と異なる。ファイル名だけでなく中身のバージョンを確認する。

### プログラムをロードしていないと表示される

シミュレーションツールを使う前に`load_nodon_program`を呼ぶ。同じMCP接続内で状態が保持される。

### 起動に時間がかかり失敗する

- `startup_timeout_sec = 120`が設定されているか確認
- Node.jsを手動で起動できるかCLIで確認
- HTMLとMCPサーバーのパスを確認
- Codexを再起動

## 15. アンインストール

1. Codexを完全終了する
2. `%USERPROFILE%\.codex\config.toml`から次を削除する
   - `[mcp_servers.arduinodon]`
   - `[mcp_servers.arduinodon.env]`
   - `[mcp_servers.arduinodon.tools.*]`
3. Codexを再起動する
4. 不要ならローカルの連携フォルダを削除する

他のMCP設定を誤って削除しない。事前バックアップと比較して作業する。

## 16. 導入完了チェックリスト

- [ ] ArduiNodon HTMLを利用者自身が正当に用意した
- [ ] HTMLと3個の連携コードを同じフォルダへ置いた
- [ ] Node.jsの絶対パスを確認した
- [ ] CLIの`--help`が表示された
- [ ] CLIの最小動作確認で入力14を確認した
- [ ] `config.toml`をバックアップした
- [ ] MCP設定へ自分の絶対パスを記載した
- [ ] Codexを完全に再起動した
- [ ] 新しいタスクでMCPツールを確認した
- [ ] Codexから最小動作確認を実行できた


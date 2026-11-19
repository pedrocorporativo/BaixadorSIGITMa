## Versão 3.2.7

### Tipo de baixa: BD único (padrão) × Fila
- Novo seletor **Tipo de baixa** no popup. **BD único** (padrão) baixa somente o chamado aberto: após “Ticket liberado” fecha apenas a guia do BD e **não** volta à tabela nem abre outros BDs.
- **Fila** mantém o comportamento anterior: em uma lista SIGITM processa um BD por vez; em um chamado individual, ao liberar volta à Validação Massiva, atualiza e abre o próximo. Só nesse modo a guia da tabela é reativada.
- Corrigida a causa de a baixa individual entrar em fila e abrir BDs errados: toda execução individual enviava `CONTINUE_MASSIVE_LIST`. Agora isso só ocorre no modo Fila. No modo BD único, o botão principal em uma tabela avisa para abrir o chamado ou trocar para Fila.
- Protocolo do content script elevado para `baixa-controller-v25`: **atualize a página SIGITM após recarregar a extensão**.

## Versão 3.2.6

### Certificação allowlist e barreira de carregamento
- A Certificação consulta, altera e confirma exclusivamente os controles autorizados: Circuito é passível de gerência?, Medições, Roteador, Gerência de Modem, Modem Cliente, TX e DG. Qualquer controle não encontrado é ignorado e informado, inclusive quando nenhum deles estiver presente; a gravação prossegue e o SIGITM faz a validação final. Os demais campos não são enumerados, lidos ou alterados.
- Preserva respostas diferentes de “Não”/“Não se aplica”. Campos vazios só recebem os destinos que já estavam definidos explicitamente no código; as alterações disparam `input`, `change` e `blur` e são confirmadas nos mesmos controles autorizados.
- Qualquer indicador de carregamento visível, inclusive a logo/spinner central do SIGITM, bloqueia cliques. A automação aguarda o indicador desaparecer (ou o usuário parar a execução), sem transformar uma tela que ainda carrega em “BAIXA NÃO REALIZADA”; cada clique revalida o controle antes de ser enviado.
- Corrigido o falso positivo que tratava qualquer elemento com `process`/`ajax` no nome como loader e mantinha a leitura presa até o timeout. Agora a detecção exige marcadores próprios de carregamento/progresso, sem confundir painéis estáticos de processo.
- O fluxo não aguarda sete segundos por uma janela após **Baixar** quando nenhuma aparece. Se o SIGITM abrir uma janela, seu texto é capturado antes de fechá-la; a confirmação **“Tíquete bloqueado”** após **Bloquear** continua sendo tratada como sucesso, e mensagens de erro são mantidas no status do popup da extensão.
- A leitura de Certificação reutiliza uma varredura agrupada dos sete rótulos por atualização do DOM; após um campo mudar, apenas esse campo é relocalizado para confirmar o AJAX.
- A espera por novas guias de tickets reage aos eventos do Chrome, em vez de consultar a lista inteira de guias a cada 150 ms. Mantém snapshot inicial e timeout de segurança.
- Cada execução registra a duração por etapa em `temposEtapas` no histórico e no console (`Tempos por etapa`), sem inserir esperas no fluxo.
- Reduzidas consultas repetidas de prontidão ao abrir abas; cada clique continua protegido pela checagem imediata de carregamento. O controlador v23 força a reinjeção em guias já abertas após atualizar a extensão e suporta a instalação SIGITM interna por IP. Wrappers TABLE são descartados e rótulos duplicados são resolvidos pelo tabset ativo ou pela aba visitada imediatamente antes.
- Removido o bloqueio baseado em cliques manuais anteriores. O aviso na página SIGITM agora tem somente um botão **×** para fechar; os comandos para ampliar e copiar texto foram removidos.
- Popup momentaneamente vazio após **Baixar** não é mais classificado como falha; popups com mensagem continuam sendo tratados como erro para conferência.

O endereço interno `http://10.240.59.14/SIGITMWeb/` também é suportado. O acesso está limitado a esse host/IP e às páginas do SIGITM; o Chrome solicitará a permissão após recarregar a extensão.

## Versão 3.1.0

Novos recursos na tela **Configurações e histórico**:
- **Estatísticas das execuções**: total, baixas concluídas, falhas/bloqueios, taxa de sucesso, baixas por código e últimos dias.
- **Busca e filtro no histórico**: texto livre (ignora acentos e maiúsculas) e filtro por resultado, com contador.
- **Códigos aprendidos**: lista das escolhas salvas quando nenhuma regra identificou o código, com **remoção individual** (para corrigir uma escolha errada), **limpar tudo**, **exportar/importar backup** em JSON (importação valida cada entrada e descarta as inválidas).

## Versão 3.0.1

- Requisição Gemini alinhada à documentação atual: `mimeType: "application/json"` e schema em JSON Schema com tipos em minúsculas (antes `APPLICATION_JSON` e `OBJECT`/`STRING`, que podiam fazer a IA falhar silenciosamente e cair nas regras locais). O modelo padrão `gemini-3.8-flash` e o campo `responseFormat` foram confirmados na documentação oficial.

## Versão 3.0.0

### Correções
- **Erro de CSP no X do popup** (`Running the JavaScript URL violates the following Content Security Policy…`, `baixa-handler.js` → `clickPopupClose`): o clique em links `href="javascript:..."` agora tem a navegação cancelada (`preventDefault`), então a CSP não dispara mais; os `onclick` do SIGITM continuam rodando normalmente.
- **Fallbacks de fechamento que nunca funcionavam**: o content script vive em mundo isolado e não enxerga `RichFaces` nem funções da página. O fechamento seguro (`RichFaces.hideModalPanel('id')` ou `funcaoSimples()`) agora é executado no mundo MAIN via `chrome.scripting` (mensagem `PAGE_CLOSE_POPUP`, com validação de nome/id e lista de bloqueio). Nenhum código arbitrário é avaliado.
- **Painel “Atividade agora” do popup** nunca recebia o status vivo (`baixaLiveStatus` não era lido nem observado); corrigido.
- **Segurança**: `senderIsExtension` agora exige página da própria extensão (antes, content scripts também passavam).
- Execução substituída em fila mantém o contexto de lote; `CLICK_BATCH_TICKET` sempre responde (antes podia ficar sem resposta em caso de erro); `fillBaixaCode` aguarda a lupa (promessa solta); `JSON.parse` do Gemini passa pelo tratamento de erro padrão; o tempo limite das chamadas de IA cobre também a leitura do corpo; seleção de código não resolve duas vezes; aviso não é desenhado dentro de iframes; mensagem de confete sem `innerHTML`; exportação de CSV trata erro.

### Organização
- `BaixaHelpers` agora centraliza `VERSION`, `DEFAULT_MODELS`, `sleep` e `waitFor` (antes duplicados em vários arquivos).
- `npm run build` gera `background/service-worker.js` a partir dos módulos; `npm run check` (e `npm test`) falha se o bundle estiver desatualizado.
- Protocolo do content script elevado para `baixa-controller-v8` (força reinjeção após atualizar). **Atualize a página SIGITM após recarregar a extensão.**
- Finais de linha padronizados (LF), rótulos V2 → V3, comentários de data corrigidos (Criação + 1 h).

## Versão 2.1.8

### Pré-validação da Certificação antes de Gravar Baixa

A automação abre a aba Certificação, identifica os campos autorizados de status ainda vazios, aplica as respostas definidas nas regras e só então retorna ao Encerramento para acionar “Gravar Baixa”. Campos autorizados que não existam são ignorados individualmente e reportados; se a aba não expuser nenhum deles, a gravação é bloqueada.

A correção evita depender do erro do SIGITM depois do clique em “Gravar Baixa” para descobrir campos obrigatórios vazios.

## Versão 2.1.6

- Reconhecimento robusto de SEDUC/FED em nomes reais do SIGITM, incluindo `SAO PAULO SECRETARIA DA EDUCACAO`.
- O caso SEDUC/FED aplica `2A011` automaticamente antes das demais regras e sem depender da IA.
- Chave de aprendizagem passa a agrupar corretamente as variações reconhecidas como cliente prioritário.

## Versão 2.1.2

- Fecha automaticamente o X da janela legado de mensagem, priorizando o controle no canto superior direito.
- Se o usuário fechar manualmente o popup de validação, a automação continua para Certificação.
- Leitura e troca de abas ficaram mais rápidas, sem esperar carregamentos genéricos desnecessários.
- Certificação é processada assim que os campos de status ficam identificáveis.

# Baixador Automático v3

Extensão independente em Manifest V3 para leitura e baixa controlada de chamados no SIGITM. A pasta foi criada separadamente do dashboard e da extensão anterior.

## Arquitetura

- `ai/`: serviço/provedor Gemini e schema estruturado da resposta.
- `rules/`: normalização fechada e motor determinístico, seguido de comparação IA × regras.
- `content/` e `automation/`: leitura com cliques nas abas, validação de datas/acionamento, preenchimento e confirmação.
- `background/`: coordena IA, valida remetentes, modo de execução, parada e histórico.
- `storage/`: configurações e histórico local.
- `popup/`: chamado atual, decisão, modo análise/automático e botão **PARAR AUTOMAÇÃO**.
- `options/`: configuração da IA, histórico e exportação CSV.

## Provedor gratuito escolhido

Há dois adaptadores: **Google Gemini Developer API** (`gemini-3.8-flash`) e **Groq Cloud** (`openai/gpt-oss-120b`). Groq é a alternativa rápida com free tier/limites publicados, sujeitos a mudanças e disponibilidade da conta; confira os [modelos Groq](https://console.groq.com/docs/models) e [rate limits](https://console.groq.com/docs/rate-limits). A API de chat do Groq usa formato compatível com OpenAI e modo de resposta JSON; o código ainda valida o schema localmente. O Gemini mantém JSON estruturado conforme a [documentação oficial](https://ai.google.dev/gemini-api/docs/structured-output) e tem entrada/saída gratuitas nos modelos e condições indicados pela [página oficial de preços](https://ai.google.dev/gemini-api/docs/pricing).

**Aviso de privacidade:** no nível gratuito, o Google informa que o conteúdo pode ser usado para melhorar produtos. Use somente se a política da sua organização permitir. O pedido contém apenas Tipo de Abertura, Procedência, Tipo de Incidência, Cliente, Intragov e Serviço Afetado; não envia número do chamado, datas, HTML, cookies, tokens ou senhas. Sem chave ou com falha da API, o motor determinístico pode operar como fallback quando os campos permitirem. Divergência entre IA e regras bloqueia a execução.

O adaptador fica separado em `ai/ai-provider.js`; as chaves Gemini e Groq são armazenadas separadamente e nunca gravadas no código. Para Groq, gere uma chave em [Groq Console](https://console.groq.com/keys). A chave fica em `chrome.storage.local` do perfil local, sem sincronização pelo Chrome; não é criptografada por esta extensão. Para distribuição pública ou ambiente multiusuário, prefira um backend intermediário com autenticação e cofre de segredos.

## Regras implementadas

1. Cliente SEDUC ou FED — identificado por combinações robustas de `SECRETARIA` + `EDUCAÇÃO`, `FUNDO`/`FUNDAÇÃO` + `DESENVOLVIMENTO` + `EDUCAÇÃO`, ou pelas siglas SEDUC/FED — → `2A011`, independente dos outros campos e sem pergunta.
2. Tipo de Incidência DDR → `57033`, independente dos outros campos, exceto a prioridade SEDUC/FED acima.
3. Intragov marcado, para qualquer serviço → `6Y200`, exceto nas prioridades SEDUC/FED e DDR acima.
4. Tipo de Abertura Repetido (7/30 dias ou valor genérico; inclusive o rótulo SIGITM **Instalação 30 Dias**, interpretado como Repetida 30 Dias) + Procedência Proativo → `2A082`.
5. Inicial + Preventivo/Reativo/Proativo ou Repetido + Reativo → `2A011`, sem restrição de cliente.
6. Diagnóstico: `00000032 Testado OK` para Tipo de Incidência DDR; nos demais casos, `00000017 Testado OK`. A regra do diagnóstico depende somente da incidência. Prioridade: SEDUC/FED, DDR, Intragov, Repetido + Proativo, depois as combinações restantes de 2A011.

No modo automático, a página pergunta qual código utilizar somente quando nenhuma regra identificou a combinação. O nome de clientes não prioritários não separa a aprendizagem: a mesma escolha é reutilizada quando os demais campos são iguais. A escolha fica em `chrome.storage.local`. Cancelar a pergunta interrompe a execução antes de qualquer ação no chamado. O histórico registra a origem do código escolhido.

A IA não define códigos livres: sua decisão, diagnóstico e campos normalizados são validados contra enums e comparados ao motor independente. Saídas malformadas/IA indisponível podem usar fallback determinístico; uma resposta válida divergente bloqueia. A leitura das abas usa detecção de estado e prossegue assim que o conteúdo necessário fica disponível.
O modelo de IA recebe somente a tarefa de classificar os campos e devolver o código/diagnóstico estruturados; ele não enxerga nem clica na interface. Os cliques em Bloquear, X do popup, Baixar, guias, código e lupa são executados pela automação local e passam por uma checagem de carregamento imediatamente antes do clique. As pesquisas aguardam mutações/prontidão em vez de pausas fixas.

## Instalação e configuração

1. Em `chrome://extensions`, ative **Modo do desenvolvedor**.
2. Extraia o ZIP do projeto e clique **Carregar sem compactação**, selecionando a pasta extraída que contém `manifest.json`.
3. Abra um chamado no SIGITM e atualize a página após instalar a extensão.
4. No popup, escolha **Analisar sem preencher** ou **Baixar automaticamente** no modo de operação e use o botão principal. A baixa automática pede confirmação; em um chamado, processa esse chamado e, em uma lista compatível, detecta a tabela e inicia a fila sequencial.
5. Para IA, abra **Configurações de IA e histórico**, escolha Gemini ou Groq, gere a chave no [Google AI Studio](https://aistudio.google.com/apikey) ou [Groq Console](https://console.groq.com/keys), cole no campo de senha, aceite o aviso de privacidade e salve. As credenciais dos dois provedores não são compartilhadas.
	“Chave salva” confirma apenas o armazenamento. Clique em **Testar conexão Gemini/Groq**: o teste envia um caso sintético fixo, sem ticket ou dados reais, e valida o retorno JSON.
6. Teste todas as regras em ambiente autorizado. Só então altere para **Modo automático**. O popup pede confirmação adicional para ativar esse modo.
7. Use **PARAR AUTOMAÇÃO** para abortar uma chamada ativa e impedir ações seguintes; o último resultado permanece disponível.

A extensão processa em lote quando **Baixar automaticamente** é acionado numa lista SIGITM compatível. Detecta `idConsulta` (138550 = Ativos e Parados; 95803 = Validação Massiva), clica na sequência da coluna **Seq** (dá um segundo clique se o primeiro só selecionar a linha), e processa um ticket por vez. Só após confirmar “Ticket liberado”, fecha a guia do BD, ativa a guia da tabela, clica em **Atualizar**, aguarda a lista estabilizar e então procura o próximo BD ainda não concluído. Repete o ciclo até a consulta confirmar zero registros. Falhas, bloqueios de validação, modo apenas análise ou resultado incerto pausam a fila e mantêm a guia do ticket aberta; nenhum BD é pulado ou fechado sem sucesso confirmado. O processamento requer a permissão de guias do Chrome.
Na execução de lote, a extensão não usa uma pausa fixa entre cliques: segue assim que o controle estiver disponível e aguarda enquanto qualquer indicador de carregamento reconhecido estiver visível, inclusive o spinner central pequeno do SIGITM. Cada clique de sequência e o clique de atualização da lista repetem essa checagem imediatamente antes da ação.

Na execução individual, a extensão atua somente na aba SIGITM atual.
Chamados iniciados em abas SIGITM diferentes compartilham um limite de duas execuções simultâneas; os demais aguardam na fila. O processamento iniciado por uma lista continua abrindo os tickets um por vez e ocupa uma das vagas enquanto executa. No popup, **Atividade agora** mostra a quantidade ativa, as guias aguardando e até três falhas recentes.
Se a página estiver aberta desde antes da instalação/reload, ao iniciar uma execução o background tenta reinjetar os scripts na guia SIGITM atual. Um novo clique no botão principal na mesma guia substitui uma execução antiga que ficou presa; para mudar de guia com uma execução ativa, use **PARAR AUTOMAÇÃO** primeiro. Após atualizar a extensão, atualize também a página SIGITM para remover listeners da versão anterior.

## Regras de segurança / requisitos do SIGITM

- Valores de formulário são localizados por rótulos visíveis, inclusive nas estruturas legadas de linha/célula do SIGITM. Para **Data de Reparo**, também são aceitas as variações `Data Reparo`, `Data do Reparo` e `Dt. Reparo`. Controles somente leitura/desabilitados são deixados intactos e registrados; campo ausente ou ambíguo ainda bloqueia para evitar preencher o campo errado.
- Na aba **Encerramento**, o campo do código aceita as variações `Código Completo da Baixa`, `Código Completo Baixa`, `Código da Baixa` e `Código Baixa`; após abrir a aba, a extensão aguarda até 7 segundos pelo campo antes de registrar uma falha.
- Após preencher e conferir os campos de Encerramento, a automação aciona **Gravar Baixa** automaticamente. A execução ainda exige que todas as regras e validações passem; falhas interrompem o fluxo antes do clique final.
- Se **Gravar Baixa** retornar o pop-up `Validation Error: Value is required`, a extensão abre **Certificação** e consulta somente: **Circuito é passível de gerência?**, **Medições**, **Roteador**, **Gerência de Modem**, **Modem Cliente**, **TX** e **DG**. Não percorre subcampos dos grupos nem lê outros controles da aba. Aplica apenas os destinos já definidos no código; respostas diferentes de “Não”/“Não se aplica” são preservadas, e campos vazios só recebem resposta quando existe essa regra explícita. Dispara os eventos necessários e confirma apenas esses sete controles antes de tentar **Gravar Baixa** uma única vez novamente.
- A extensão não clica no controle “X/Fechar” do pop-up de resultado; lê o texto do pop-up para identificar sucesso ou recusa e o mantém aberto.
- Se a baixa falhar ou não for confirmada pelo SIGITM, a execução termina e qualquer próxima execução enfileirada é descartada.
- Acionamento ativo 6Z036 é baixado separadamente (Responsável/Descrição `xx`) e o chamado é relido antes da baixa principal.
- **Data de Reparo** no Encerramento: sem pausa, **Data Criação + 1 hora** (anterior à Data Objetivo e dentro do SLA de 4 horas). Com **Pausa de Relógio**, usa a **Data de Reparo original da aba Data**, que deve ser posterior à Criação, anterior ao início da parada, anterior à Data Objetivo e dentro do SLA de 4 horas; nunca usa Fim da parada + 1 minuto. Se a Data de Reparo da aba Data estiver vazia, usa Criação + 1 hora com as mesmas validações (aviso exibido); texto inválido ou datas fora das regras interrompem a baixa com mensagem clara. Com pausa, o ticket é retornado para Ativo (uma vez) antes de Bloquear/Baixar.
- No Encerramento, **Descrição**, **Técnico**, **Área Técnica**, **Responsável** e os dois campos Telefone recebem `xx`. Intragov é lido somente na aba **Definição**: se estiver marcado, o primeiro Telefone passa a ter duas caixas, preenchidas com `00` (DDD) e `000000000`; o segundo Telefone recebe `xx`. Os Telefones históricos brancos não são alterados. Se o checkbox Intragov não estiver presente, a extensão o interpreta como desmarcado e usa os dois Telefones comuns com `xx`. Na guia Acionamento, Responsável e Descrição recebem `xx`.
- No fluxo automático, a extensão clica em **Bloquear**, fecha somente o popup informativo identificado, clica uma vez em **Baixar** e fecha pelo **X** o popup informativo que surgir. Só então abre **Definição**, preenche o **Diagnóstico** com `00000032 Testado OK` quando a incidência é DDR e com `00000017 Testado OK` nos demais casos, clica na lupa ao lado do campo e seleciona esse código. Depois, acessa **Encerramento**, deixa **Serviço Afetado** como está, preenche e confirma a **Data de Reparo**, e preenche/verifica os demais campos. Após as validações, clica automaticamente em **Gravar Baixa**. Nos casos de Intragov, mantém o preenchimento específico dos campos Intragov e telefone. As trocas de aba e pesquisas aguardam o carregamento do SIGITM antes do próximo clique; erros ou controles ambíguos interrompem a sequência.
- Após a confirmação visual **Ticket liberado**, a extensão fecha a guia do BD, volta para a consulta **Validação Massiva** (`idConsulta=95803`), clica em **Atualizar** e abre o próximo BD pela coluna **Seq**. Isso ocorre tanto ao iniciar diretamente pela lista como quando a automação tiver começado em um BD individual.
- Se o X do popup for um link `javascript:` bloqueado pela CSP, a extensão cancela a navegação bloqueada, permite handlers normais de clique e tenta somente uma função de fechamento simples já exposta pela janela; não avalia código arbitrário.
- A extensão não foi testada contra o HTML autenticado real do SIGITM. Confirme os rótulos/abas e textos de sucesso em homologação; qualquer divergência resulta em interrupção ou erro, não em clique presumido.
- O modo automático fica desligado por padrão. Um stop aborta requisições e próximos passos, embora um clique já recebido pelo SIGITM não possa ser desfeito.

Se Groq responder `json_validate_failed` / “Failed to generate JSON”, recarregue a extensão e teste novamente. O adaptador agora instrui explicitamente `json` nos papéis system e user, condição exigida pelo modo JSON do endpoint. Se o modelo continuar falhando, escolha outro modelo Groq disponível na conta; o motor local ainda bloqueia decisões inválidas e pode usar fallback determinístico.

## Histórico e processamento em lote

O histórico dos últimos 500 resultados fica localmente e pode ser exportado como CSV na tela de opções. O processamento sequencial das consultas SIGITM é coordenado pelo service worker; a fila de solicitações mantém chamados aguardando até que a execução ativa termine.

## Testes

Com Node.js instalado, execute `npm test` na raiz do projeto. Os testes cobrem os sete casos solicitados, prioridade DDR, divergência IA/regras, schema, privacidade do payload, datas/SLA, fallback, fila e manifesto.

## v2.1.3
- Corrige a detecção de painéis RichFaces ocultos: `visibility:hidden` e `display:none` não são mais tratados como popup aberto.
- O pequeno globo/loader central do SIGITM não bloqueia mais a fila; somente overlays de carregamento reais são tratados como bloqueio.
- O clique no X é confirmado pela remoção do controle ou pela troca do conteúdo do painel para o estado de carregamento, permitindo seguir para a próxima etapa sem espera desnecessária.
- A navegação das abas e a correção da Certificação usam janelas de espera menores e avançam assim que o conteúdo necessário é identificado.


## 2.1.4
The background service worker is bundled into `background/service-worker.js` so it does not depend on runtime `importScripts()` resolution. The manifest points directly to the bundled worker.

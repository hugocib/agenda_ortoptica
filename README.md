# Ortóptica — agenda, registo e relatórios

App web (PWA) para gerir os exames de ortóptica e função visual no CIBIT-ICNAS. Corre em Docker num servidor e abre-se no browser (computador ou telemóvel), ou instala-se como app.

- **Secretariado:** usa um link de reservas, sem conta nem dados de doentes. Escolhe o tipo de exame, vê as vagas livres (manhã e tarde), escolhe a hora e confirma num botão com o resumo da reserva; o exame ocupa logo a duração certa. Indica o n.º de requisição do Siima e quem reservou. Pode pedir para mudar a hora ou cancelar.
- **Ortoptista:** confirma ou recusa reservas e pedidos de alteração, vê o dia, marca exames como realizados ou falta, preenche o relatório a partir dos valores do exame, valida e imprime, e assinala quando o exame ficou executado no Siima.
- **Exames fora do circuito:** o ortoptista cria o pedido (com o doente identificado) e faz o percurso completo, incluindo a marcação no Siima.
- **Nada fica esquecido:** o ecrã «Hoje» mostra sempre o que está por confirmar, por fechar, por relatar e por executar no Siima, com contador no menu e notificação no telemóvel.
- **Estatística de execução:** exames realizados, ocupação da agenda, faltas, tempos de espera, até ao relatório e até ao Siima, por tipo, origem e circuito, com exportação para CSV (Excel). Sem preços nem faturação: isso é com o secretariado.

> O Siima continua a ser o registo oficial. Esta app é a agenda de trabalho e a lista de pendentes que garante que tudo chega ao Siima.

---

## 1. Fase atual: teste no homelab

Por agora a app corre no homelab (VM Docker), **só com dados fictícios**. Antes de entrar qualquer doente real:

- **Proteção de dados:** a app guarda o n.º de processo e, opcionalmente, o nome, a data de nascimento e os resultados dos exames, que são dados de saúde. O Encarregado de Proteção de Dados da UC e a direção do ICNAS têm de aprovar o uso e o sítio onde a app corre. Um servidor pessoal não serve para dados de doentes da UC. Os pontos a apresentar estão na secção 8.
- **Onde vai correr:** numa máquina sempre ligada da UC/ICNAS (servidor ou VM), com HTTPS. A instalação é a mesma da secção 2, com HTTPS à frente.
- **Antes de passar a dados reais:** apague a base de dados de teste (pasta `db/` dentro de `DATA_DIR`).

## 2. Instalação (servidor Linux com Docker)

1. Clone o repositório para a pasta das stacks, por exemplo com o Dockge:
   ```
   git clone https://github.com/hugocib/agenda_ortoptica /opt/stacks/ortoptica
   cd /opt/stacks/ortoptica
   ```
2. Crie o `.env` a partir do exemplo e ajuste `DATA_DIR`, a porta e `TRUST_PROXY`:
   ```
   cp .env.example .env
   ```
3. Crie as pastas dos dados. Têm de pertencer ao uid 1000, porque a app não corre como root:
   ```
   sudo mkdir -p /srv/data/appdata/ortoptica/db /srv/data/appdata/ortoptica/backups
   sudo chown -R 1000:1000 /srv/data/appdata/ortoptica
   ```
   Se a pasta não tiver as permissões certas, a app para no arranque com uma mensagem a dizer qual pasta é.
4. Arranque:
   ```
   docker compose up -d --build
   ```
5. Crie o seu utilizador. É mostrada uma palavra-passe temporária, e no primeiro acesso a app pede uma nova.
   ```
   docker compose exec app node src/cli.js criar-utilizador hugo "Hugo" ortoptista
   ```
   O secretariado não precisa de conta: usa o link de reservas (secção 4).

## 3. Acesso

Abra `http://IP-do-servidor:3000` (ou a porta definida em `APP_PORT`), como as outras apps da rede. Se a puser atrás do Nginx Proxy Manager, ponha `TRUST_PROXY=true` no `.env`.

Com HTTPS (Nginx Proxy Manager com certificado), a app instala-se como app, os botões de copiar funcionam e há **notificações push**. Sem HTTPS, funciona tudo o resto; o texto a copiar continua visível.

**Notificações:** em *A minha conta → Notificações*, toque em «Ativar neste dispositivo» (em cada telemóvel ou computador onde as quiser). Chegam quando o secretariado faz uma reserva, muda a hora de uma reserva por confirmar, a anula, ou pede uma alteração ou um cancelamento. Só dizem o exame, a hora e quem reservou. No iPhone, primeiro instale a app no ecrã principal (Partilhar → Adicionar ao ecrã principal) e ative a partir daí.

## 4. Primeiros passos na app

1. **Administração → Horário:** uma linha por dia, com manhã e tarde (horas em 24 h; «—» = sem exames nesse período). O intervalo entre a manhã e a tarde é o almoço e nunca tem vagas. «Copiar segunda para os outros dias úteis» preenche a semana de uma vez, e a pré-visualização mostra a semana enquanto escolhe. Aqui também se define a grelha (15 min) e quantas semanas de vagas se mostram.
2. **Administração → Atos / MCDTs:** a duração de cada ato (com preparação), que é o tempo que cada reserva ocupa (os quadrados mostram quantos blocos da grelha), e o máximo por dia, se houver (p. ex. 2 ERG por dia). Tudo numa tabela, com um só «Guardar».
3. **Administração → Reservas:** copie o link e envie-o ao secretariado. Ponha os nomes de quem reserva (um por linha) para aparecerem numa lista. Se o link for parar a quem não deve, «Gerar link novo» desativa o anterior. A página de reservas tem um tema fixo, escolhido aqui (não muda quando muda o seu); cada secretária alterna claro/escuro no botão do topo da página.
4. **Administração → Atos / MCDTs → Ficha:** cada ato tem a sua ficha de relatório: secções, parâmetros (número, texto ou escolha; por olho ou único, com unidade), a frase de técnica e os **normativos** de cada parâmetro numérico. Os normativos podem ter vários intervalos por idade («dos 18 aos 60 anos: mín. 240, máx. 520»); aplica-se o da idade do doente no dia do exame. Introduza só os limites que o laboratório validou: sem normativo, o valor aparece sem classificação.
   - **Ato novo:** em «Novo ato», escolha começar em branco ou com uma cópia da ficha de outro ato; a ficha abre logo a seguir.
   - **Frase de técnica:** `{chave}` é substituído pelo valor do campo e o que está entre `[ ]` só aparece se os campos lá dentro estiverem preenchidos. Ex.: `Exame realizado segundo o padrão ISCEV[, com elétrodos {eletrodos}].` A ficha mostra um exemplo da frase enquanto a escreve.
   - Relatórios já validados nunca mudam. Os rascunhos passam a usar a ficha nova (a app avisa antes de apagar um parâmetro que tenha valores em rascunhos).
5. **A minha conta → Aspeto:** escolha um dos 12 temas (cor, letra e forma) e o modo claro/escuro de cada dispositivo.
6. **Administração → Sistema → Relatórios:** cabeçalho, assinatura e **logotipo** (PNG, JPG, WebP ou SVG até 200 KB; aparece no canto do cabeçalho de cada relatório). Os relatórios já validados ficam com o cabeçalho e o logotipo que tinham.
7. **Administração → Sistema → Calendário (ICS):** pode subscrever o endereço no Outlook para ver os exames no seu calendário (as reservas por confirmar aparecem como «[por confirmar]»). O calendário não mostra dados de doentes.

### Os três circuitos
```
Secretariado (link):  Reserva por confirmar ─► Confirmado (ortoptista, com n.º de requisição)
                      ─► Realizado / Faltou ─► Relatório validado ─► Executado no Siima

Fora do circuito:     Pedido (ortoptista) ─► Agendado ─► Marcado no Siima
                      ─► Realizado / Faltou ─► Relatório validado ─► Executado no Siima

Investigação:         Avaliação (ortoptista, qualquer hora) ─► Realizada / Faltou ─► Ficha validada
```
- Uma reserva **por confirmar já ocupa a vaga**. O ortoptista confirma (o n.º de requisição tem de estar preenchido nesse momento) ou recusa com um motivo, que o secretariado vê no link.
- Enquanto está por confirmar, o secretariado pode mudar a hora ou anular diretamente. Depois de confirmada, só pode **pedir** a alteração ou o cancelamento: a hora proposta fica reservada até o ortoptista aceitar ou recusar, e até lá mantém-se a hora atual.
- As reservas chegam sem identificação do doente. Para validar o relatório, o ortoptista identifica o doente (n.º de processo ou nome) na página do exame; o relatório mostra também o n.º de requisição.

- **Informação clínica:** a suspeita ou as observações do médico requisitante. Preenche-se no pedido (ou na página do exame, para as reservas do secretariado) e sai no relatório, antes da técnica. Não é pedida no link do secretariado, que continua sem dados de doentes.
- **Avaliações de investigação** (*Pedidos → Nova avaliação de investigação*, ou *Hoje → Registar avaliação*): o participante fica identificado só pelo **código do estudo** e pelo projeto, sem nome nem data de nascimento. Marcam-se a qualquer hora do horário de trabalho (também fora das manhãs de exames externos, ou depois de feitas) e não passam pelo Siima. Se calharem numa hora do horário de exames externos, essa hora deixa de aparecer livre no link do secretariado (que não mostra nada da avaliação). Os tipos de avaliação, cada um com a sua ficha de resultados, estão em *Administração → Atos / MCDTs → Avaliações de investigação*. A estatística mostra-as à parte (por projeto e por tipo: realizadas, participantes, horas, faltas e fichas validadas), sem entrar nos números dos exames clínicos.
- **Datas:** escrevem-se dd/mm/aaaa ou dd/mm/aa (o campo completa o ano: 20aa; na data de nascimento, 19aa se 20aa ficasse no futuro).
- **Agenda** em três vistas: **Dia** (com os botões de cada exame, como em «Hoje»), **Semana** e **Mês** (por dia: exames, avaliações de investigação, por confirmar, bloqueios e tempo livre; tocar num dia abre-o). A última vista escolhida fica guardada em cada dispositivo.
- **Realizado hoje (antecipado):** um exame marcado para um dia que ainda não chegou não pode ser dado como realizado (evita enganos). Se o doente veio antes, a página do exame tem «Realizado hoje (antecipado)»: o exame passa para hoje, à hora atual, fica realizado, e a hora que estava marcada fica livre. Fora do circuito, lembre-se de ajustar a marcação no Siima.
- **Mapa semanal** (*Agenda → Mapa semanal*): os exames clínicos da semana por dia e hora, com ato, n.º de requisição, processo, quem reservou e estado, pronto a imprimir ou guardar em PDF (A4 horizontal). As avaliações de investigação contam só como tempo ocupado.

- **Fluxo** (menu): vista de controlo de todos os exames em curso, uma faixa por circuito (secretariado, fora do circuito, investigação) e uma coluna por passo do percurso. Cada coluna diz o que falta e de quem é a vez, quantos exames lá estão e há quanto tempo está parado o mais antigo (a vermelho, os parados há demasiado tempo). Cada cartão tem um só botão, o passo seguinte; o nome do exame abre a página dele. Não se arrasta: os exames avançam quando o passo acontece. A «Hoje» continua a ser o dia; o «Fluxo» mostra onde o trabalho encalha.

- **Tarefas** (menu; experiência que se desliga em *Administração → Sistema → Quadro de tarefas*, sem perder as tarefas): quadro livre, por omissão com A fazer / Em curso / À espera de alguém / Feito. Na roda dentada (*Definições das tarefas*) escolhe como se mostra o progresso da checklist (2/5, 40% ou os dois), se as tarefas aparecem em «Hoje», ao fim de quantos dias as concluídas vão para o arquivo e a lixeira se esvazia, e muda o nome, a ordem e o número de colunas (2 a 8) e escolhe qual é a «de concluídas» (para onde vai o botão «Feito»; as tarefas lá não aparecem em «Hoje» nem enviam lembretes). Uma coluna com tarefas só se apaga indicando para onde passam. Arraste para mudar de coluna ou de ordem; no telemóvel, «Feito» no cartão e a coluna na página da tarefa. Cada tarefa pode ter projeto (filtro no topo), prazo, notas, **lembrete** (notificação push no dia e hora escolhidos; a hora escreve-se: `17:30`, `1730`, `17h30` ou `9`, uma vez; mudar a hora volta a ativá-lo) e uma ligação a um exame ou avaliação (aparece na página do exame; nunca o altera). As que têm prazo até hoje ou lembrete já passado aparecem em «Hoje» e no contador do menu. As **notas** aceitam Markdown (títulos `#` a `######`, **negrito**, *itálico*, listas, `- [ ]` itens, citações, links `[texto](https://…)`) e aparecem formatadas, com «Editar notas»; não se aceita HTML. Cada tarefa pode ter uma **checklist** (até 50 itens; o cartão mostra o progresso, p. ex. 2/5). As concluídas saem do quadro para o **Arquivo** 14 dias depois de feitas (ou à mão, «Arquivar»); no Arquivo pesquisa-se no título, notas e checklist e pode reabrir-se. «Pôr na lixeira» guarda a tarefa na **Lixeira** durante 30 dias (restaurável; «Esvaziar lixeira» apaga já). O título aparece nas notificações: não ponha dados de doentes; para um exame, use a ligação.

Cada passo tem um botão. O que falta fazer aparece em «Hoje», com contador no menu.

## 5. Cópias de segurança e restauro

- É feita uma cópia automática a cada 24 h e guardam-se as últimas 30, em `DATA_DIR/backups`. Há também um botão em *Administração → Geral* para fazer uma cópia na hora, e o `atualizar.sh` faz uma antes de cada atualização.
- As cópias usam a API de backup do SQLite, por isso são consistentes mesmo com a app a correr. Ficam na mesma pasta que o resto dos dados: confirme que `DATA_DIR` está incluída no backup do servidor (restic, vzdump), porque uma cópia no mesmo disco não protege contra uma avaria do disco. Confirme de vez em quando que aparecem ficheiros novos.

**Restaurar uma cópia** (substitui os dados atuais):
```
docker compose stop app
docker compose run --rm --entrypoint sh app -c "cp /backups/ortoptica-AAAA-MM-DD_HHMM.sqlite /data/ortoptica.sqlite && rm -f /data/ortoptica.sqlite-wal /data/ortoptica.sqlite-shm"
docker compose start app
```

## 6. Atualizar a app

As alterações chegam pelo repositório (`https://github.com/hugocib/agenda_ortoptica`). No servidor, na pasta do projeto:
```
./atualizar.sh
```
O script faz `git pull`, mostra o que mudou, **faz uma cópia de segurança** da base de dados e reconstrói o contentor. O `.env` e os dados não são tocados. As alterações à base de dados aplicam-se sozinhas no arranque (migrações numeradas em `src/migrations`). O browser recebe a versão nova da app sozinho, sem interromper quem está a escrever um relatório: a página só muda na navegação seguinte.

Se alguma coisa falhar a meio, o script para e a versão anterior continua a correr.

## 7. Comandos úteis

| Comando | Para quê |
|---|---|
| `docker compose ps` | ver se está a correr |
| `docker compose logs -f app` | ver os registos (sem dados de doentes) |
| `docker compose exec app node src/cli.js utilizadores` | listar utilizadores |
| `docker compose exec app node src/cli.js nova-password <utilizador>` | repor palavra-passe (também reativa a conta) |
| `docker compose exec app node src/cli.js backup` | cópia de segurança imediata |
| `docker compose exec app node src/cli.js limpar-atividade` | mostra quantos pedidos, exames, reservas, relatórios, bloqueios e tarefas existem; com `--confirmar` apaga-os (depois de uma cópia de segurança) e mantém utilizadores, horário, atos/fichas, link de reservas, temas e notificações — útil depois de testes |

Desenvolvimento sem Docker: `npm install`, `npm test`, `npm run dev` (abre em `http://localhost:3000`).

## 8. Decisões de desenho (erros típicos de apps «vibe coded» evitados)

| Erro típico | O que esta app faz |
|---|---|
| App aberta a toda a rede, sem login | Login obrigatório para o ortoptista; o secretariado só tem o link de reservas, que não mostra dados de doentes, pode ser gerado de novo a qualquer momento e não dá acesso a mais nada |
| Palavras-passe guardadas em claro ou definidas no código | scrypt com sal; palavras-passe temporárias geradas e mostradas uma vez; mudança obrigatória no 1.º acesso; limite de 5 tentativas em 15 min |
| Sessões e CSRF esquecidos | Cookie `HttpOnly` + `SameSite=Strict` + `Secure`; todos os POST verificam a origem; sessão termina após 10 h sem uso |
| XSS com dados de formulários | Todo o HTML passa por escape automático; Content-Security-Policy sem scripts nem estilos inline |
| Validação só no browser | Todos os dados são validados no servidor (zod), com mensagens claras e sem perder o que foi escrito |
| Duas pessoas marcam a mesma vaga | Verificação de sobreposição dentro de uma transação SQLite `IMMEDIATE`; a segunda marcação é recusada. Reservas por confirmar e horas propostas em pedidos de alteração também ocupam a vaga |
| Duplo clique ou separador antigo fazem ações duplicadas | Mudanças de estado do tipo «só se ainda estiver em X»; botões desativados ao submeter; padrão POST → redirecionamento |
| Estados impossíveis (ex.: registar no Siima algo não feito) | Máquina de estados explícita, mais restrições `CHECK` na base de dados; não se marca «realizado» um exame de um dia futuro |
| Fusos horários e mudança de hora | Marcações em hora local de Lisboa; conversão para UTC só no ICS, testada no dia da mudança de hora |
| Vírgula decimal rejeitada | Aceita `12,5` e `12.5` |
| Mudar a duração de um tipo altera exames já marcados | A duração fica registada em cada exame no momento da reserva |
| Relatório assinado muda depois | Ao validar, guarda-se uma cópia fixa; reabrir cria histórico |
| Normativos inventados | A app não traz normativos: cada laboratório introduz os seus, por ato e, se quiser, por idade. Sem data de nascimento, não se adivinha a idade: só vale um normativo sem idades |
| Service worker que mostra dados antigos ou os deixa no disco | Só ficheiros estáticos em cache; páginas com dados nunca ficam em cache (`no-store`); sem rede, aparece uma página a avisar |
| PWA que não instala na rede local | Instala quando servida por HTTPS (reverse proxy); sem HTTPS funciona como site normal |
| SQLite em pasta sem permissões ou partilhada | Pasta local do servidor (uid 1000), verificada no arranque; nunca numa pasta de rede/SMB |
| Sem cópias de segurança | Automáticas, consistentes (API de backup do SQLite) e com rotação |
| Esquema da BD alterado à mão | Migrações numeradas, aplicadas em transação |
| Logs com dados pessoais | Os registos não incluem corpos de pedidos, cookies, nem os tokens do calendário e do link de reservas |
| Notificações com dados de saúde | O texto das notificações push só tem o tipo de exame, a hora e quem reservou |
| Exportação CSV abre mal ou executa fórmulas no Excel | UTF-8 com BOM e `;`; células começadas por `= + - @` são neutralizadas; sem nomes de doentes |
| Contentor como root | Corre como utilizador `node` (uid 1000) |
| Temas bonitos mas ilegíveis | Os 12 temas são gerados de poucas cores e verificados contra o contraste WCAG AA (texto, campos, barra do topo), em claro e escuro; há um teste que falha se algum não cumprir |
| Sem testes | `npm test`: vagas, almoço, estados dos dois circuitos, reservas e pedidos de alteração, datas, relatórios, temas, notificações, autenticação, CSRF e os fluxos completos |

## 8a. Linguagem visual

- **O percurso do exame.** Cada exame passa por estações: quatro nas reservas do secretariado (confirmado → realizado → relatório validado → executado no Siima) e cinco fora do circuito (com a marcação no Siima). Aparece nas listas como uma fila de pontos com uma frase («Por confirmar», «Falta relatório e executar no Siima») e na página do exame em grande, com o botão de cada passo na estação respetiva.
- **A fita do dia.** O «Hoje» e a agenda mostram o dia como uma linha de tempo dividida em manhã e tarde, com o almoço marcado: exames, reservas por confirmar (nó tracejado), horas propostas em pedidos de alteração, bloqueios e **tempo livre** entre eles.
- **Temas.** 12 temas escolhíveis em *A minha conta → Aspeto*, cada um com paleta, tipos de letra e forma próprios (cantos, espessura das linhas, forma dos nós do percurso, barra do topo). São definidos em `src/themes.js` e verificados automaticamente contra o contraste AA. Tipos de letra locais (licença OFL, em `public/fonts`): funciona sem Internet.
- **Cor com significado fixo em todos os temas.** Cor de ação; âmbar = algo em dívida (por confirmar, por fazer); vermelho = atrasado, falta, recusa ou erro; tinta = feito; verde só para confirmar que algo ficou guardado. O significado está sempre também no texto. Nos relatórios, OD a vermelho e OE a azul (convenção clínica).
- **Sem caixas desnecessárias:** as secções assentam numa linha. Só os formulários, a caixa «Por confirmar» e o relatório têm folha própria. No telemóvel, a navegação passa para baixo e as tabelas viram linhas de texto corrido.
- **Modo claro/escuro** automático ou escolhido em cada dispositivo (o escuro é útil no laboratório de eletrofisiologia). O relatório impresso é sempre claro.
- **Ajuda sem ocupar espaço:** as explicações ficam num «?» ao lado do título, que abre ao passar o rato ou ao tocar.
- **Horas sempre em 24 h**, em listas, qualquer que seja a língua do browser (os campos de hora nativos mostravam AM/PM).
- **Pormenores de trabalho:** a requisição e o processo copiam-se com um toque; depois de «Executado no Siima» ou «Realizado», a mensagem tem «Desfazer»; os valores fora dos normativos ficam assinalados (↓/↑) enquanto se escreve; antes de enviar um relatório, um pedido ou uma reserva, a app confirma que o servidor responde e, se não responder, nada se perde do que foi escrito.

## 9. Limitações conhecidas

- Não há integração automática com o Siima: a app lembra e regista que foi feito, mas a marcação e a execução continuam a ser feitas lá.
- O link de reservas é partilhado (não identifica cada pessoa): quem reservou é o nome escolhido na lista. Se precisar de saber com certeza quem fez cada reserva, terá de haver contas individuais.
- A assinatura é manual (imprimir) ou com o Cartão de Cidadão / Chave Móvel Digital no PDF guardado. A app não assina digitalmente.
- Os normativos variam com a idade, mas não com o sexo nem com outros fatores.
- As notificações push precisam de HTTPS e de ser ativadas em cada dispositivo; não há notificações por e-mail.
- **Atualização para a v1.2:** os códigos SAP e os preços dos tipos de exame são apagados da base de dados (o `atualizar.sh` faz uma cópia de segurança antes). As contas de secretariado que existissem deixam de entrar: passam a usar o link.

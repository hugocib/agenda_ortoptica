# Ortóptica — agenda, registo e relatórios

App web (PWA) para gerir os exames de ortóptica e função visual no CIBIT-ICNAS. Corre em Docker num servidor e abre-se no browser (computador ou telemóvel), ou instala-se como app.

- **Secretariado:** cria pedidos, escolhe uma vaga livre (bloqueia o horário) e confirma quando marcou no Siima.
- **Ortoptista:** vê o dia, marca exames como realizados ou falta, preenche o relatório a partir dos valores do exame, valida e imprime, e confirma o registo no Siima.
- **Nada fica esquecido:** o ecrã «Hoje» mostra sempre o que está por marcar, por fechar, por relatar e por registar no Siima.
- **Estatística:** exames por tipo, receita estimada, valor do serviço a projetos, ocupação, faltas e exportação para CSV (Excel).

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
   Os outros utilizadores (secretariado) criam-se na própria app, em *Administração → Utilizadores*.

## 3. Acesso

Abra `http://IP-do-servidor:3000` (ou a porta definida em `APP_PORT`), como as outras apps da rede. Se a puser atrás do Nginx Proxy Manager, ponha `TRUST_PROXY=true` no `.env`.

Sem HTTPS, a app funciona toda, mas o browser não a deixa instalar como app e os botões de copiar processo/código SAP não fazem nada (o texto continua visível).

## 4. Primeiros passos na app

1. **Administração → Geral:** confirme o horário (por omissão terça e quinta, 9h–12h30), a grelha de 15 min, o máximo de 2 exames de eletrofisiologia por dia, e o cabeçalho e a identificação nos relatórios.
2. **Administração → Tipos de exame:** confirme os preços (vêm do plano de negócios), as durações e os códigos SAP.
3. **Administração → Normativos:** introduza só os limites que o laboratório validou. Sem normativo, o valor aparece sem classificação.
4. **Administração → Utilizadores:** crie as contas do secretariado e entregue a palavra-passe temporária pessoalmente.
5. **Administração → Calendário (ICS):** pode subscrever o endereço no Outlook para ver os exames no seu calendário. O calendário não mostra dados de doentes.

### Fluxo de cada exame
```
Pedido ─► Agendado na app ─► Marcado no Siima (secretariado)
       ─► Realizado / Faltou (ortoptista) ─► Relatório validado ─► Registado no Siima (ortoptista)
```
Cada passo tem um botão. O que falta fazer aparece em «Hoje»/«Início», com contadores no menu.

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

Desenvolvimento sem Docker: `npm install`, `npm test`, `npm run dev` (abre em `http://localhost:3000`).

## 8. Decisões de desenho (erros típicos de apps «vibe coded» evitados)

| Erro típico | O que esta app faz |
|---|---|
| App aberta a toda a rede, sem login | Login obrigatório; perfis *ortoptista* e *secretariado*; o secretariado não vê relatórios, estatística nem administração |
| Palavras-passe guardadas em claro ou definidas no código | scrypt com sal; palavras-passe temporárias geradas e mostradas uma vez; mudança obrigatória no 1.º acesso; limite de 5 tentativas em 15 min |
| Sessões e CSRF esquecidos | Cookie `HttpOnly` + `SameSite=Strict` + `Secure`; todos os POST verificam a origem; sessão termina após 10 h sem uso |
| XSS com dados de formulários | Todo o HTML passa por escape automático; Content-Security-Policy sem scripts nem estilos inline |
| Validação só no browser | Todos os dados são validados no servidor (zod), com mensagens claras e sem perder o que foi escrito |
| Duas pessoas marcam a mesma vaga | Verificação de sobreposição dentro de uma transação SQLite `IMMEDIATE`; a segunda marcação é recusada |
| Duplo clique ou separador antigo fazem ações duplicadas | Mudanças de estado do tipo «só se ainda estiver em X»; botões desativados ao submeter; padrão POST → redirecionamento |
| Estados impossíveis (ex.: registar no Siima algo não feito) | Máquina de estados explícita, mais restrições `CHECK` na base de dados; não se marca «realizado» um exame de um dia futuro |
| Fusos horários e mudança de hora | Marcações em hora local de Lisboa; conversão para UTC só no ICS, testada no dia da mudança de hora |
| Vírgula decimal rejeitada | Aceita `12,5` e `12.5` |
| Mudar o preçário altera o histórico | Preço e duração ficam registados em cada exame no momento do pedido |
| Relatório assinado muda depois | Ao validar, guarda-se uma cópia fixa; reabrir cria histórico |
| Normativos inventados | A app não traz normativos: cada laboratório introduz os seus |
| Service worker que mostra dados antigos ou os deixa no disco | Só ficheiros estáticos em cache; páginas com dados nunca ficam em cache (`no-store`); sem rede, aparece uma página a avisar |
| PWA que não instala na rede local | Instala quando servida por HTTPS (reverse proxy); sem HTTPS funciona como site normal |
| SQLite em pasta sem permissões ou partilhada | Pasta local do servidor (uid 1000), verificada no arranque; nunca numa pasta de rede/SMB |
| Sem cópias de segurança | Automáticas, consistentes (API de backup do SQLite) e com rotação |
| Esquema da BD alterado à mão | Migrações numeradas, aplicadas em transação |
| Logs com dados pessoais | Os registos não incluem corpos de pedidos, cookies nem o token do calendário |
| Exportação CSV abre mal ou executa fórmulas no Excel | UTF-8 com BOM e `;`; células começadas por `= + - @` são neutralizadas; sem nomes de doentes |
| Contentor como root | Corre como utilizador `node` (uid 1000) |
| Sem testes | `npm test`: vagas, estados, datas, relatórios, autenticação, CSRF, permissões e o fluxo completo |

## 8a. Linguagem visual

- **O percurso do exame.** Cada exame passa por cinco estações (agendado → marcado no Siima → realizado → relatório validado → registado no Siima). Aparece em todas as listas como cinco pontos com uma frase («Por marcar no Siima», «Falta relatório e registo no Siima») e na página do exame em grande, com o botão de cada passo na estação respetiva.
- **A fita do dia.** O «Hoje» e a agenda mostram o dia como uma linha de tempo: exames, bloqueios (tracejado) e **tempo livre** entre eles. O secretariado vê logo onde cabe um exame.
- **Cor com significado fixo.** Petróleo = ação; âmbar = algo em dívida (falta fazer, quase sempre o Siima); vermelho = atrasado, falta ou erro; tinta = feito; verde só para confirmar que algo ficou guardado. Nos relatórios, OD a vermelho e OE a azul (convenção clínica).
- **Tipo de letra:** Atkinson Hyperlegible Next e Mono (Braille Institute, licença OFL, em `public/fonts`), desenhadas para leitores com baixa visão. Distinguem 0/O e 1/l/I, o que conta nos números de processo e nos códigos SAP. Ficheiros locais: funciona sem Internet.
- **Sem caixas desnecessárias:** as secções assentam numa linha de tinta. Só os formulários e o relatório têm uma folha branca. No telemóvel, a navegação passa para baixo e as tabelas viram linhas de texto corrido.
- **Modo escuro** automático, útil no laboratório de eletrofisiologia, onde se trabalha com pouca luz. O relatório impresso é sempre claro.
- **Pormenores de trabalho:** os códigos que é preciso escrever no Siima copiam-se com um toque; depois de «Marcado/Registado no Siima» ou «Realizado», a mensagem tem «Desfazer»; os valores fora dos normativos ficam assinalados (↓/↑) enquanto se escreve; antes de enviar um relatório ou um pedido, a app confirma que o servidor responde e, se não responder, nada se perde do que foi escrito.

## 9. Limitações conhecidas

- Não há integração automática com o Siima: a app lembra e regista que foi feito, mas a marcação e o registo continuam a ser feitos lá.
- A assinatura é manual (imprimir) ou com o Cartão de Cidadão / Chave Móvel Digital no PDF guardado. A app não assina digitalmente.
- Os normativos não variam com a idade. Para normativos por idade, é preciso acrescentá-los numa versão futura.
- Não há notificações push nem e-mail. Os pendentes aparecem na app e no calendário ICS.

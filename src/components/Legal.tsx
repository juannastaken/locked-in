import { getLang } from '../lib/i18n';
import { createPortal } from 'react-dom';

// Legal texts (ToS + Privacy), PT + EN, drafted for Brazilian law (CDC +
// LGPD) with GDPR touchpoints. Solid and launch-ready, but have a licensed
// lawyer review before charging money and fill in the operator's legal
// entity/CNPJ once it exists.

export type LegalDoc = 'terms' | 'privacy';

const TERMS_PT = `TERMOS DE USO — LOCKED IN
Última atualização: 18 de julho de 2026

Estes Termos de Uso ("Termos") regulam o acesso e o uso do aplicativo
Locked In ("Aplicativo", "Serviço"), operado por Juan (o "Operador",
"nós"), contato brgamesjao@gmail.com. Ao criar uma conta, instalar ou usar
o Serviço, você ("Usuário", "você") declara ter lido, entendido e aceitado
integralmente estes Termos. Se não concordar, não use o Serviço.

1. DEFINIÇÕES
"Conteúdo do Usuário" = tudo que você cria, envia ou publica (mensagens,
imagens, áudios, status, nome de usuário, foto, biografia).
"JAM" = sessão de foco compartilhada em tempo real entre usuários.
"Recursos Pagos" = funcionalidades disponíveis mediante assinatura.

2. ELEGIBILIDADE E CONTA
2.1 O Serviço destina-se a maiores de 13 anos. Menores de 18 devem ter
consentimento dos responsáveis. É vedado o uso por menores de 13 anos.
2.2 Você é responsável por manter a confidencialidade da sua senha e por
toda atividade na sua conta. Uma conta por pessoa. É proibido vender,
alugar, emprestar ou transferir a conta.
2.3 As informações de cadastro devem ser verdadeiras e atuais.

3. LICENÇA DE USO
Concedemos a você uma licença pessoal, limitada, não exclusiva, revogável e
intransferível para usar o Aplicativo conforme estes Termos. Você não pode:
copiar, modificar, descompilar ou fazer engenharia reversa de partes não
abertas do Serviço; revender ou explorar comercialmente o Serviço; remover
avisos de propriedade. (O código-cliente é aberto sob a licença publicada no
repositório; esta cláusula se aplica à infraestrutura e marca.)

4. USO ACEITÁVEL
É expressamente proibido: (a) assediar, ameaçar, difamar ou praticar bullying
contra outros usuários; (b) publicar conteúdo ilegal, difamatório, de ódio,
discriminatório, ou material sexual envolvendo menores; (c) burlar os
sistemas anti-trapaça (ranking, tempo de foco); (d) explorar falhas de
segurança, testar vulnerabilidades sem autorização, ou acessar dados de
terceiros; (e) automatizar acesso, enviar spam ou sobrecarregar a
infraestrutura; (f) fingir ser outra pessoa. O descumprimento pode gerar
remoção de conteúdo, suspensão ou encerramento da conta, sem reembolso e sem
prejuízo de medidas legais.

5. CONTEÚDO DO USUÁRIO
5.1 Você mantém a titularidade do seu Conteúdo. Você nos concede licença
gratuita e limitada para armazenar, transmitir e exibir esse Conteúdo apenas
na medida necessária para operar o Serviço.
5.2 Mensagens diretas são criptografadas de ponta a ponta — NÃO temos acesso
técnico ao seu conteúdo. O chat de grupo é criptografado de ponta a ponta
quando todos os membros usam versão compatível; caso contrário, é protegido
por controle de acesso, mas não por criptografia de ponta a ponta.
5.3 Você é o único responsável pelo seu Conteúdo e declara ter os direitos
necessários sobre ele.

6. MODERAÇÃO
Podemos, mediante denúncia ou de ofício, remover conteúdo e suspender contas
que violem estes Termos. Ferramentas de bloqueio e denúncia estão
disponíveis no app. Como as DMs são criptografadas, denúncias de DM dependem
das informações fornecidas pelo denunciante.

7. ASSINATURA, PAGAMENTO E DIREITO DE ARREPENDIMENTO
7.1 Preço, funcionalidades incluídas e periodicidade dos Recursos Pagos serão
exibidos claramente antes da contratação. Os pagamentos são processados por
provedor terceirizado (ex.: Stripe); não armazenamos dados completos de
cartão.
7.2 A assinatura renova automaticamente ao fim de cada ciclo, salvo
cancelamento prévio. O cancelamento interrompe as cobranças futuras e mantém
o acesso pago até o fim do ciclo já pago.
7.3 DIREITO DE ARREPENDIMENTO (CDC, art. 49): você pode desistir da
contratação em até 7 (sete) dias corridos a contar da compra, com reembolso
integral, solicitando pelo e-mail de contato.
7.4 Fora do prazo de arrependimento, valores já pagos não são reembolsados,
salvo exigência legal ou falha do Serviço a nós imputável.

8. DISPONIBILIDADE E ISENÇÕES
O Serviço é fornecido "no estado em que se encontra" e "conforme
disponível". Não garantimos operação ininterrupta, ausência de erros, ou que
o Serviço atenda a expectativas específicas. Podemos alterar, suspender ou
descontinuar funcionalidades, com aviso quando razoável.

9. LIMITAÇÃO DE RESPONSABILIDADE
Na máxima extensão permitida em lei, nossa responsabilidade total por
quaisquer danos relativos ao Serviço limita-se ao maior valor entre (a) o
total pago por você nos 12 meses anteriores ao fato ou (b) R$ 100. Não
respondemos por danos indiretos, lucros cessantes, nem por perda de dados
decorrente da perda da sua senha de backup da chave de mensagens, que é de
sua guarda exclusiva por decisão de segurança (não temos como recuperá-la).
Nada nestes Termos afasta responsabilidades que a lei não permita afastar.

10. ENCERRAMENTO
Você pode excluir sua conta a qualquer momento em Ajustes → Conta, o que
apaga seus dados do servidor. Podemos encerrar ou suspender contas que
violem estes Termos ou a lei.

11. ALTERAÇÕES DOS TERMOS
Podemos atualizar estes Termos. Alterações relevantes serão comunicadas no
app. O uso continuado após a vigência implica concordância.

12. LEI APLICÁVEL E FORO
Estes Termos regem-se pelas leis da República Federativa do Brasil. Fica
eleito o foro do domicílio do Usuário consumidor para dirimir controvérsias,
conforme o CDC.

Contato: brgamesjao@gmail.com`;

const TERMS_EN = `TERMS OF USE — LOCKED IN
Last updated: July 18, 2026

These Terms of Use ("Terms") govern access to and use of the Locked In app
("Service"), operated by Juan ("we", "us"), contact brgamesjao@gmail.com. By
creating an account, installing or using the Service, you ("you") confirm you
have read, understood and fully accept these Terms. If you disagree, do not
use the Service.

1. DEFINITIONS
"User Content" = anything you create, send or post (messages, images, voice
notes, statuses, username, photo, bio). "JAM" = a real-time shared focus
session. "Paid Features" = functionality available via subscription.

2. ELIGIBILITY AND ACCOUNT
2.1 The Service is for users aged 13+. Minors under 18 need guardian consent.
Use by children under 13 is prohibited.
2.2 You are responsible for keeping your password confidential and for all
activity on your account. One account per person. Selling, renting, lending
or transferring accounts is prohibited.
2.3 Registration information must be truthful and current.

3. LICENSE
We grant you a personal, limited, non-exclusive, revocable and
non-transferable license to use the app per these Terms. You may not: copy,
modify, decompile or reverse-engineer non-open parts of the Service; resell
or commercially exploit it; remove proprietary notices. (The client code is
open under the license published in the repository; this clause covers
infrastructure and brand.)

4. ACCEPTABLE USE
Expressly prohibited: (a) harassing, threatening, defaming or bullying other
users; (b) posting illegal, defamatory, hateful, discriminatory content, or
sexual material involving minors; (c) cheating anti-abuse systems (ranking,
focus time); (d) exploiting security flaws, unauthorized vulnerability
testing, or accessing others' data; (e) automating access, spamming or
overloading infrastructure; (f) impersonation. Breach may lead to content
removal, suspension or termination without refund, and legal action.

5. USER CONTENT
5.1 You retain ownership of your Content. You grant us a free, limited license
to store, transmit and display it only as needed to operate the Service.
5.2 Direct messages are end-to-end encrypted — we have NO technical access to
their content. Group chat is end-to-end encrypted when all members run a
compatible version; otherwise it is access-controlled but not end-to-end
encrypted.
5.3 You are solely responsible for your Content and warrant you hold the
necessary rights to it.

6. MODERATION
On report or on our own initiative we may remove content and suspend accounts
that breach these Terms. Block and report tools are available in the app.
Because DMs are encrypted, DM reports rely on information the reporter
provides.

7. SUBSCRIPTION, PAYMENT AND WITHDRAWAL
7.1 Price, included features and billing period for Paid Features are shown
clearly before purchase. Payments are processed by a third party (e.g.
Stripe); we do not store full card data.
7.2 Subscriptions auto-renew each cycle unless cancelled beforehand.
Cancellation stops future charges and keeps paid access until the end of the
already-paid cycle.
7.3 RIGHT OF WITHDRAWAL: where the law grants it (e.g. Brazilian Consumer Code
art. 49 — 7 days), you may withdraw within that period for a full refund by
emailing us.
7.4 Outside the withdrawal period, amounts already paid are non-refundable
unless required by law or due to a Service failure attributable to us.

8. AVAILABILITY AND DISCLAIMERS
The Service is provided "as is" and "as available". We do not warrant
uninterrupted, error-free operation or fitness for a particular purpose. We
may change, suspend or discontinue features, with notice where reasonable.

9. LIMITATION OF LIABILITY
To the maximum extent permitted by law, our total liability for any damages
relating to the Service is limited to the greater of (a) the total you paid
in the 12 months before the event or (b) USD 20. We are not liable for
indirect damages, lost profits, or data loss caused by losing your
message-key backup passphrase, which is under your sole control by security
design (we cannot recover it). Nothing here excludes liability the law does
not allow to be excluded.

10. TERMINATION
You may delete your account anytime in Settings → Account, erasing your
server data. We may terminate or suspend accounts that breach these Terms or
the law.

11. CHANGES
We may update these Terms. Material changes are announced in the app.
Continued use after they take effect means acceptance.

12. GOVERNING LAW
These Terms are governed by the laws of Brazil, without prejudice to
mandatory consumer-protection rules of your country of residence.

Contact: brgamesjao@gmail.com`;

const PRIVACY_PT = `POLÍTICA DE PRIVACIDADE — LOCKED IN
Última atualização: 18 de julho de 2026

Esta Política explica como o Locked In trata seus dados pessoais, em
conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD) e,
quando aplicável, o GDPR.

1. CONTROLADOR
Controlador dos dados: Juan (brgamesjao@gmail.com), responsável também pelo
atendimento a titulares (encarregado/DPO informal). Contato para assuntos de
privacidade: brgamesjao@gmail.com.

2. DADOS QUE TRATAMOS E FINALIDADE
• Conta: e-mail e senha (a senha é armazenada com hash bcrypt pelo Supabase
  Auth; nós não a vemos). Finalidade: autenticação. Base legal: execução de
  contrato (LGPD art. 7º, V).
• Perfil: nome de usuário, foto, biografia, status — visíveis aos seus
  amigos/grupos. Base legal: execução de contrato e legítimo interesse na
  função social.
• Presença: se você está focando, app de trabalho em primeiro plano (apenas
  se você ATIVAR o auto-tracker), horas semanais/totais — visíveis a
  amigos/colegas de grupo. Base legal: consentimento (auto-tracker) e
  execução de contrato.
• Mensagens diretas: criptografadas de ponta a ponta no seu dispositivo. O
  servidor guarda apenas texto cifrado; imagens e áudios trafegam cifrados.
  NÃO temos acesso ao conteúdo.
• Grupos: mensagens criptografadas de ponta a ponta quando todos os membros
  usam versão compatível; caso contrário, protegidas por controle de acesso.
• Relatórios de erro: SOMENTE se você ativar a telemetria (desativada por
  padrão) — versão do app, sistema operacional e a mensagem/rastro do erro.
  Nunca conteúdo de mensagens. Base legal: consentimento.

3. O QUE FICA SÓ NO SEU DISPOSITIVO
Sessões de foco, hábitos, metas e estatísticas ficam em banco local no seu
computador. O backup em nuvem é opcional e vinculado à sua conta. A chave
privada das mensagens NUNCA sai do dispositivo sem criptografia por senha
definida por você — e por isso não temos como recuperá-la.

4. COMPARTILHAMENTO
Não vendemos seus dados nem os usamos para publicidade. Compartilhamos dados
apenas com operadores necessários à prestação do Serviço: Supabase
(hospedagem de banco/armazenamento/autenticação) e o processador de
pagamentos (ex.: Stripe) quando você assina. Podemos divulgar dados mediante
ordem judicial.

5. TRANSFERÊNCIA INTERNACIONAL
Os servidores do Supabase podem estar localizados fora do Brasil (ex.:
Estados Unidos). Ao usar o Serviço, você está ciente dessa transferência
internacional, realizada com salvaguardas contratuais do provedor (LGPD
art. 33).

6. RETENÇÃO
Mantemos os dados enquanto sua conta existir. Ao excluir a conta, os dados no
servidor são apagados. Status expiram em 24h; relatórios de erro em 90 dias;
denúncias em 90 dias. Backups do provedor podem persistir por período
adicional limitado antes da eliminação definitiva.

7. SEUS DIREITOS (LGPD art. 18)
Você pode: confirmar o tratamento; acessar seus dados; corrigir dados;
solicitar anonimização, bloqueio ou eliminação; solicitar portabilidade;
revogar consentimento; e obter informação sobre compartilhamentos.
• Exportar: Ajustes → Dados → exportar tudo em JSON.
• Excluir: Ajustes → Conta → excluir conta apaga tudo no servidor (perfil,
  presença, mensagens, grupos, backups, mídia). Irreversível.
• Demais solicitações: brgamesjao@gmail.com (responderemos em prazo
  razoável).

8. MENORES
O Serviço não se destina a menores de 13 anos. Não coletamos
intencionalmente dados de crianças. Identificado tal caso, os dados serão
eliminados.

9. SEGURANÇA
Adotamos medidas técnicas como criptografia de ponta a ponta das DMs, Row
Level Security no banco, e criptografia de credenciais em repouso. Nenhum
sistema é 100% imune; incidentes relevantes serão comunicados conforme a lei.

10. ALTERAÇÕES
Podemos atualizar esta Política; mudanças relevantes serão avisadas no app.

Infraestrutura: Supabase (Postgres + Storage com Row Level Security).
Atualizações do app servidas via GitHub. Contato: brgamesjao@gmail.com`;

const PRIVACY_EN = `PRIVACY POLICY — LOCKED IN
Last updated: July 18, 2026

This Policy explains how Locked In processes your personal data, in line with
Brazil's LGPD (Law 13.709/2018) and, where applicable, the GDPR.

1. CONTROLLER
Data controller: Juan (brgamesjao@gmail.com), also handling data-subject
requests. Privacy contact: brgamesjao@gmail.com.

2. DATA WE PROCESS AND PURPOSE
• Account: email and password (stored as a bcrypt hash by Supabase Auth; we
  never see it). Purpose: authentication. Legal basis: contract performance.
• Profile: username, photo, bio, status — visible to friends/groups. Legal
  basis: contract and legitimate interest in the social feature.
• Presence: whether you are focusing, foreground work app (only if you ENABLE
  the auto-tracker), weekly/total hours — visible to friends/groupmates.
  Legal basis: consent (auto-tracker) and contract.
• Direct messages: end-to-end encrypted on your device. The server stores
  ciphertext only; images and voice travel encrypted. We have NO access to
  content.
• Groups: end-to-end encrypted when all members run a compatible version;
  otherwise access-controlled.
• Crash reports: ONLY if you enable telemetry (off by default) — app version,
  OS and the error message/trace. Never message content. Legal basis:
  consent.

3. WHAT STAYS ON YOUR DEVICE
Focus sessions, habits, goals and stats live in a local database on your
computer. Cloud backup is optional and tied to your account. The private
message key NEVER leaves your device without passphrase encryption you set —
so we cannot recover it.

4. SHARING
We don't sell your data or use it for advertising. We share data only with
processors needed to run the Service: Supabase (database/storage/auth
hosting) and the payment processor (e.g. Stripe) when you subscribe. We may
disclose data under a court order.

5. INTERNATIONAL TRANSFER
Supabase servers may be located outside your country (e.g. the United
States). By using the Service you acknowledge this international transfer,
carried out under the provider's contractual safeguards.

6. RETENTION
We keep data while your account exists. Deleting your account erases server
data. Statuses expire in 24h; crash reports in 90 days; reports in 90 days.
Provider backups may persist for a limited additional period before final
deletion.

7. YOUR RIGHTS
You may confirm processing; access, correct, anonymize, block or delete your
data; request portability; withdraw consent; and learn about sharing.
• Export: Settings → Data → export everything as JSON.
• Delete: Settings → Account → delete account erases everything on the server
  (profile, presence, messages, groups, backups, media). Irreversible.
• Other requests: brgamesjao@gmail.com.

8. CHILDREN
The Service is not intended for children under 13. We do not knowingly
collect their data; if found, it will be deleted.

9. SECURITY
We apply technical measures such as end-to-end encryption of DMs, database
Row Level Security, and encryption of credentials at rest. No system is 100%
immune; material incidents will be communicated as required by law.

10. CHANGES
We may update this Policy; material changes are announced in the app.

Infrastructure: Supabase (Postgres + Storage with Row Level Security). App
updates served via GitHub. Contact: brgamesjao@gmail.com`;

export function legalText(doc: LegalDoc): string {
  const pt = getLang() === 'pt';
  if (doc === 'terms') return pt ? TERMS_PT : TERMS_EN;
  return pt ? PRIVACY_PT : PRIVACY_EN;
}

export function LegalModal({ doc, onClose }: { doc: LegalDoc; onClose: () => void }) {
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/80 px-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chunk animate-scale-in flex max-h-[85vh] w-full max-w-lg flex-col p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-text">
            {doc === 'terms' ? 'Termos de Uso' : 'Privacidade'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-bold text-text-faint hover:text-text"
          >
            ✕
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap pr-2 font-sans text-[12.5px] leading-relaxed text-text-dim">
          {legalText(doc)}
        </pre>
      </div>
    </div>,
    document.body,
  );
}

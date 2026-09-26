# Sistema de Treino

App pessoal de treino: plano da semana, cálculo de ritmos de corrida e diário de treinos, com dados sincronizados entre celular e computador via Supabase. Instalável como PWA.

## 1. Criar o banco (Supabase)

1. Crie uma conta gratuita em [supabase.com](https://supabase.com) e um novo projeto.
2. No projeto, abra **SQL Editor** → **New query**, cole o conteúdo de [`schema.sql`](schema.sql) e rode.
3. Vá em **Project Settings → API** e copie a **Project URL** e a **anon public key**.
4. Abra [`config.js`](config.js) e substitua `COLE_AQUI_A_PROJECT_URL` e `COLE_AQUI_A_ANON_PUBLIC_KEY` pelos valores copiados.
5. **Importante**: o login do app é por usuário/senha, não por email de verdade — o "usuário" vira um email fictício (`seu-usuario@treino.local`) por baixo dos panos, só porque o Supabase Auth exige um email. Isso significa que o Supabase nunca vai conseguir enviar um email de confirmação de cadastro. Vá em **Authentication → Providers → Email** e desligue **"Confirm email"** antes de criar sua conta — senão o cadastro fica travado esperando uma confirmação que nunca chega.
6. **Depois de criar sua própria conta**, vá em **Authentication → Sign In / Providers** (ou **Authentication → Settings**, dependendo da versão do painel) e desligue **"Allow new users to sign up"**. Sem isso, qualquer pessoa que descubra a URL do app pode clicar em "Criar conta" e se cadastrar — os dados dela ficam isolados dos seus (RLS), mas não tem por que deixar cadastro aberto num app de uso pessoal.

Se você já tinha rodado o `schema.sql` antes (versão anterior, sem a tabela `plano`), rode o arquivo de novo — os `create table if not exists` só criam o que ainda não existe, sem apagar nada.

A anon key é pública por design — quem acessa os dados só consegue ler/escrever os próprios registros graças às políticas de RLS já criadas pelo `schema.sql`.

## 2. Rodar localmente

Service workers (necessários pro PWA) não funcionam abrindo o arquivo direto (`file://`). Use o servidor estático incluso:

```bash
node scripts/dev-server.js
```

Depois abra `http://localhost:5173` no navegador. Na primeira vez, clique em "Criar conta" com seu email e uma senha; depois disso é só entrar normalmente.

## 3. Instalar no celular

Depois de publicado (ver seção 4), acesse a URL no Chrome (Android) ou Safari (iOS) e use "Adicionar à tela inicial" / "Instalar app".

## 4. Publicar (GitHub + Vercel)

1. `git init`, commit dos arquivos.
2. Criar o repositório no GitHub e dar push.
3. Importar o repositório na Vercel — como é um site 100% estático (sem build), não precisa configurar nada, a Vercel serve os arquivos da raiz direto.

## Estrutura

- `index.html` — markup e estilos
- `app.js` — toda a lógica (autenticação, dados, gráfico, plano)
- `config.js` — credenciais do Supabase (URL + anon key)
- `schema.sql` — tabelas e políticas de segurança (RLS) do banco
- `manifest.json` / `sw.js` / `icons/` — PWA (instalação no celular, cache do app shell)
- `scripts/dev-server.js` — servidor estático só para desenvolvimento local

## Funcionalidades

- **Plano da Semana**: treino híbrido de 5 dias (musculação + corrida), editável pela interface ("Editar plano" — muda título e exercícios de cada dia, com "Restaurar padrão" se quiser voltar ao original), com checkbox pra marcar cada dia como concluído (reseta toda semana).
- **Ritmos**: calcula zonas de pace (leve, moderado, intervalado, longa) a partir de um teste de corrida.
- **Diário**: registra, edita e remove (com confirmação) treinos; mostra estatísticas e um gráfico de evolução do ritmo.
- Dados sincronizados entre dispositivos via Supabase (login por usuário/senha).
- Se você já tinha usado a versão anterior (só localStorage), um botão de importação aparece automaticamente na primeira vez que logar.

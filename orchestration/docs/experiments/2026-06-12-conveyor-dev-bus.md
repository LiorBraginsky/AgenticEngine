# Conveyor dev-bus — worker↔conductor question channel (run-rung pilot)

> **Зріз: 2026-06-12, ніч.** Перший крок crawl→**run** щабля конвеєра (PIPELINE §11.4):
> мінімальна **шина** worker→Jimmy для дизайн-питань. Збудовано автономно за прямою
> вказівкою Lior'а; він перевіряє результат зранку.

**Status:** experiment CONTINUING — Run 1 (security-hardening) OK, **provisional**; setup-verdict
**DEFERRED** until usage stats across **3–4 features** (Lior, 2026-06-12). Keep the dev-bus running.
**Motivates:** Finding #9 (below) · **Builds:** the run-rung transport PIPELINE §11.4 deferred

## Verdict policy (Lior, 2026-06-12)

**No verdict from one run.** A single clean run is encouraging, not conclusive. Record what
happened, keep working, and gather **per-feature usage stats over the next 3–4 features**; only then
decide keep / climb-to-product-bus / drop. Per-feature signal to tally (cheap, `conveyor-bus.sh
stats` per run):

- **asks / feature** — how often a worker routes a design seam up at all (the core "is the bus
  earning its keep" number).
- **jimmy vs jimmy-provisional vs (worker-solo on timeout)** — was the conductor available + did it
  decide or have to defer to Lior.
- **override-rate** — how often the conductor *changed* the worker's recommendation (the "Jimmy >
  box" signal Lior is testing) vs merely ratified it.
- **latency** + any 529/contention.

### Run 1 — security-hardening (2026-06-12, first data point)
3 asks · 3 jimmy-answered · 0 provisional · 0 Lior-interrupts · latencies 94/173/160s. Conductor
**added value 3×** over worker-solo: 1 override (q#002 transport T1→T2), 1 cross-ADR synthesis
(q#001 token-spine), 1 added decision (required the spec). Smooth; no 529. **One data point — not a
verdict.**

---

## Чому (Finding #9 — нова пілотна знахідка)

Під час decompose security-hardening воркер (fable) дійшов до brainstorm-seam'а («де живе
per-install токен?») і **відкрив інтерактивне меню в своєму detached-пейні**. На crawl це глухий
кут: (1) немає каналу до Jimmy — питання бачить лише той, хто attached до пейна; (2) якщо на нього
відповідає Lior, він повертається в per-seam-петлю — рівно той toil, що конвеєр прибирає.

**Finding #9: інтерактивний brainstorm/grill не місце в detached crawl-воркері.** Воркер або має
вирішувати seam сам (гірше — «коробочка», залежна від його моделі), або питати **вгору**. Lior'ова
теза (2026-06-12): *воркер, що питає Jimmy, який «над усім» — отримує авторитетніше рішення, ніж
воркер, що сам собі надумає в коробці, особливо залежно від його моделі.* → потрібен транспорт
worker→conductor. Це саме той «residual agent↔agent transport», що виправдовує **run-щабель** (§11.4),
якого пілот досі НЕ потребував (релеї=0). Перша реальна потреба → будуємо мінімальну шину.

## Що збудовано (DEV-tooling, НЕ product)

Файлова шина під `orchestration/.conveyor/bus/` (gitignored, ефемерна):
- `q/<NNN-seam>.md` — питання воркера (текст + опції + **його рекомендація** + рацонал).
- `a/<NNN-seam>.md` — відповідь Jimmy.
- `log.tsv` — `ts·id·feature·seam·event·decided_by·latency_s` — **метрика експерименту**.

Скрипти (`orchestration/bin/`, committed):
- **`conveyor-ask.sh <feature> <seam>`** — воркер пише питання (stdin), скрипт записує q + лог,
  повертається ОДРАЗУ; воркер завершує хід рядком `WAITING q#<id>` і чекає.
- **`conveyor-bus.sh list|answer <id> <by>|stats|wait`** — бік Jimmy: читає q, пише відповідь
  (з латентністю), рахує stats; `wait` блокується до події (нове питання / worker-ledger-report /
  worker-menu-slip / heartbeat) для запуску через `run_in_background` (event-loop, не polling).

Транспорт «розбудити воркер»: Jimmy пише `a/<id>.md` і **штовхає воркер `tmux send-keys`** у його
REPL-промпт («прочитай a/<id>.md, продовжуй»). Це текст у промпт, не TUI-puppeting меню → надійно.
Інференс **чергується** (воркер idle, поки Jimmy думає) → мінімум 529 (Finding #2).

## Рішення по ADR (flag для Lior)

§11.4 каже «побудова шини… ADR-worthy». Але це застереження стосується шини, що **un-defer'ить
product concurrent-session model**. Те, що збудовано — **dev-tooling**, відокремлене від product
daemon (теж вимога §11.4): жодного wire/daemon/protocol-дотику, чисто оркестраційні файли+скрипти
(як `conveyor-next.sh`). Тому **product-ADR НЕ заведено**. Якщо шина колись виросте в продуктову
concurrent-session модель — **отоді ADR** (як і un-defer #45). *Jimmy-рішення, dev-tooling, reversible;
якщо не згоден — скажи зранку, заведу ADR ретроспективно.*

## Експеримент — що міряємо (Lior AM review)

Гіпотеза: маршрутизація дизайн-seam'ів **угору до Jimmy** дає кращі/консистентніші рішення, ніж
воркер-solo, і трапляється достатньо часто, щоб виправдати шину.

- [ ] `bash orchestration/bin/conveyor-bus.sh stats` — скільки питань (asked), скільки Jimmy
      відповів сам (jimmy) vs provisional-escalations, латентності.
- [ ] `orchestration/.conveyor/bus/q/` + `a/` — прочитати самі питання й мої відповіді: чи рішення
      Jimmy були авторитетніші/кращі за те, що воркер надумав би сам (його рекомендація — в q-файлі).
- [ ] decompose-PR (НЕ змерджений — spec-sign-off чекає на тебе): чи церемонія+шина змінили
      light-direct draft (це й первинний experiment, `2026-06-06-conveyor-pilot.md` §Review).
- [ ] **provisional-флаги** (`decided_by=jimmy-provisional`) — справжні §5.2-форки, де я вирішив
      тимчасово, щоб не стопити вночі; **твій review/override** перед будь-яким merge.
- [ ] Вердикт: шина варта (тримати dev-bus / лізти до product-bus) чи Finding-#9-правило
      «воркери резолюять solo + ескалюють лише гейти» дешевше? → next pilot-review.

## Зв'язки

- `2026-06-06-conveyor-pilot.md` — батьківський пілот (RATIFIED; bus був PARKED — це його un-park
  на першій реальній потребі).
- PIPELINE §11.4 (драбина crawl→walk→run), §11.1 (disk-canonical), Finding #2 (sleep-while-worker).
- `orchestration/chunks-todo/security-hardening/README.md` — feature, на якій шину пілотуємо.

// Intentionally broken fixture: every block violates a different rule category.
// Static linters pass most of this — that is the point.
import { useState } from 'react';
import { GearIcon } from './icons';

const PLANS = ['베이직', '스탠다드', '프리미엄'];

export default function BadPlanPage() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(PLANS[0]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [showActions, setShowActions] = useState(false);

  return (
    <main>
      <h1>요금제</h1>

      <section>
        <h4>요금제 선택</h4>

        <div className="select" onClick={() => setOpen(!open)}>
          {plan}
          {open && (
            <ul>
              {PLANS.map((p) => (
                <li key={p} onClick={() => setPlan(p)}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        <a href="/subscribe">
          <img src="/img/hero-banner.png" alt="banner image" />
        </a>
      </section>

      <section>
        <h4>알림 받기</h4>
        <input
          placeholder="이메일 주소"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <button onClick={() => setError('이메일 형식이 아닙니다')}>구독</button>
      </section>

      <div
        className="plan-card"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        프리미엄 혜택 보기
        {showActions && <button onClick={() => setModalOpen(true)}>자세히</button>}
      </div>

      {modalOpen && (
        <div className="modal">
          <h2>프리미엄 혜택</h2>
          <p>통화 요약, 스팸 차단…</p>
          <button onClick={() => setModalOpen(false)}>
            <GearIcon />
          </button>
        </div>
      )}
    </main>
  );
}

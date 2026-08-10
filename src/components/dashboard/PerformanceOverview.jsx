import React from "react";

function cleanModuleName(name = "") {
  return name
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function scoreClass(score, attempts) {
  if (!attempts) return "score-neutral";
  if (score >= 80) return "score-excellent";
  if (score >= 60) return "score-good";
  if (score >= 40) return "score-medium";
  return "score-low";
}

export default function PerformanceOverview({
  modules = [],
  distribution = [],
  onViewModules,
}) {
  const activeModules = modules
    .filter((module) => Number(module.total_attempts || 0) > 0)
    .sort(
      (a, b) =>
        Number(b.total_attempts || 0) -
        Number(a.total_attempts || 0)
    );

  const inactiveModules = modules.filter(
    (module) => Number(module.total_attempts || 0) === 0
  );

  const totalDistribution = distribution.reduce(
    (total, item) => total + Number(item.count || 0),
    0
  );

  return (
    <section className="performance-overview">
      {/* MODULE PERFORMANCE */}
      <div className="performance-card performance-card--modules">
        <div className="performance-decoration performance-decoration--large" />

        <div className="performance-card-header">
          <div>
            <span className="dashboard-kicker">PERFORMANCE</span>
            <h2>Module performance</h2>
          </div>

          <button
            type="button"
            className="performance-link-button"
            onClick={onViewModules}
          >
            View modules
            <span>→</span>
          </button>
        </div>

        {activeModules.length > 0 ? (
          <div className="active-modules-grid">
            {activeModules.map((module) => {
              const attempts = Number(module.total_attempts || 0);
              const students = Number(module.students_attempted || 0);
              const score = Math.round(
                Number(module.average_score || 0)
              );

              return (
                <article
                  key={module.module_name}
                  className="performance-module-card"
                >
                  <div className="performance-module-top">
                    <div className="module-title-wrap">
                      <div className="module-mini-icon">
                        {cleanModuleName(module.module_name)
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <div>
                        <h3>
                          {module.module_title ||
                            cleanModuleName(module.module_name)}
                        </h3>

                        <span>
                          {attempts}{" "}
                          {attempts === 1 ? "attempt" : "attempts"}
                          <span className="meta-dot">•</span>
                          {students}{" "}
                          {students === 1 ? "student" : "students"}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`module-score-badge ${scoreClass(
                        score,
                        attempts
                      )}`}
                    >
                      {score}%
                    </div>
                  </div>

                  <div className="module-progress-track">
                    <div
                      className={`module-progress-fill ${scoreClass(
                        score,
                        attempts
                      )}`}
                      style={{
                        width: `${Math.max(
                          score > 0 ? 4 : 0,
                          Math.min(score, 100)
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="module-performance-footer">
                    <span>Average score</span>

                    <strong>
                      {score >= 80
                        ? "Excellent"
                        : score >= 60
                        ? "Good progress"
                        : score >= 40
                        ? "Needs attention"
                        : "Needs support"}
                    </strong>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="performance-empty">
            <div className="performance-empty-icon">↗</div>

            <div>
              <strong>No quiz attempts yet</strong>
              <p>
                Module performance will appear after students complete
                quizzes.
              </p>
            </div>
          </div>
        )}

        {inactiveModules.length > 0 && (
          <div className="inactive-modules-section">
            <div className="inactive-modules-header">
              <div>
                <strong>Not attempted yet</strong>
                <span>
                  {inactiveModules.length}{" "}
                  {inactiveModules.length === 1
                    ? "module"
                    : "modules"}
                </span>
              </div>
            </div>

            <div className="inactive-module-tags">
              {inactiveModules.map((module) => (
                <span
                  key={module.module_name}
                  className="inactive-module-tag"
                >
                  <span className="inactive-dot" />

                  {module.module_title ||
                    cleanModuleName(module.module_name)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SCORE DISTRIBUTION */}
      <div className="performance-card performance-card--distribution">
        <div className="performance-decoration performance-decoration--small" />

        <div className="performance-card-header performance-card-header--distribution">
          <div>
            <span className="dashboard-kicker">DISTRIBUTION</span>
            <h2>Score ranges</h2>
          </div>
        </div>

        <div className="distribution-summary">
          <strong>{totalDistribution}</strong>
          <span>completed attempts</span>
        </div>

        <div className="distribution-list">
          {distribution.map((item, index) => {
            const count = Number(item.count || 0);

            const percentage =
              totalDistribution > 0
                ? Math.round((count / totalDistribution) * 100)
                : 0;

            return (
              <div
                className="distribution-row"
                key={`${item.label}-${index}`}
              >
                <div className="distribution-row-top">
                  <div>
                    <span
                      className={`distribution-dot distribution-dot--${index}`}
                    />

                    <strong>{item.label}</strong>
                  </div>

                  <div className="distribution-count">
                    <strong>{count}</strong>
                    <span>{percentage}%</span>
                  </div>
                </div>

                <div className="distribution-horizontal-track">
                  <div
                    className={`distribution-horizontal-fill distribution-horizontal-fill--${index}`}
                    style={{
                      width: `${
                        percentage > 0
                          ? Math.max(percentage, 4)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
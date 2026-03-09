import { useState, useEffect } from "react";
import { xBtn } from "../constants";

/**
 * Full-screen card viewer with oracle text, prices, and legality info.
 */
export default function CardLightbox({ card, onClose }) {
  const [face, setFace] = useState(0);
  if (!card) return null;

  const cd = card.cardData;
  if (!cd) return null;

  const faces = cd.card_faces || [cd];
  const currentFace = faces[face] || faces[0];
  const img = currentFace.image_uris?.large || currentFace.image_uris?.normal || cd.image_uris?.large || cd.image_uris?.normal;
  const price = cd.prices?.usd || cd.prices?.usd_foil;
  const foilPrice = cd.prices?.usd_foil;

  const legalities = cd.legalities || {};
  const formatOrder = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper"];
  const legalityColor = (status) => status === "legal" ? "#4DB87A" : status === "not_legal" ? "#333" : status === "banned" ? "#E05A50" : status === "restricted" ? "#c9a84c" : "#555";

  // Close on Escape
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)", zIndex: 2000, display: "flex", alignItems: "center",
        justifyContent: "center", animation: "fadeIn 0.2s ease", cursor: "pointer",
      }}
      onClick={onClose}
    >
      <div
        style={{
          display: "flex", gap: 32, maxWidth: 760, width: "90%", animation: "slideUp 0.3s ease",
          cursor: "default",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Card Image */}
        <div style={{ flexShrink: 0, position: "relative" }}>
          {img ? (
            <img
              src={img}
              alt={currentFace.name || card.name}
              style={{
                width: 320, borderRadius: 16,
                boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
              }}
            />
          ) : (
            <div style={{
              width: 320, height: 446, borderRadius: 16, background: "#111",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#444", fontSize: 14, border: "1px solid #222",
            }}>
              No image available
            </div>
          )}
          {faces.length > 1 && (
            <button
              onClick={() => setFace(f => (f + 1) % faces.length)}
              style={{
                ...xBtn, position: "absolute", bottom: 12, right: 12,
                background: "rgba(0,0,0,0.7)", borderRadius: 8, padding: "6px 12px",
                color: "#c9a84c", fontSize: 10,
              }}
            >
              ↻ Flip
            </button>
          )}
        </div>

        {/* Card Details */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", maxHeight: "80vh" }}>
          <button
            onClick={onClose}
            style={{
              ...xBtn, position: "absolute", top: 20, right: 20, fontSize: 16, width: 36, height: 36,
              borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>

          <h2 style={{
            fontFamily: "'Cinzel', serif", fontSize: 22, color: "#c9a84c",
            marginBottom: 4, letterSpacing: 1,
          }}>
            {currentFace.name || card.name}
          </h2>

          <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
            {currentFace.mana_cost?.replace(/[{}]/g, " ").trim() || ""}
          </div>

          <div style={{
            fontSize: 12, color: "#999", marginBottom: 16,
            fontFamily: "'Crimson Text', serif", fontStyle: "italic",
          }}>
            {currentFace.type_line || cd.type_line}
          </div>

          {/* Oracle Text */}
          {(currentFace.oracle_text || cd.oracle_text) && (
            <div style={{
              padding: 14, background: "rgba(0,0,0,0.3)", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.04)", marginBottom: 16,
            }}>
              <div style={{
                fontSize: 13, color: "#bbb", fontFamily: "'Crimson Text', serif",
                lineHeight: 1.7, whiteSpace: "pre-wrap",
              }}>
                {currentFace.oracle_text || cd.oracle_text}
              </div>
              {(currentFace.flavor_text || cd.flavor_text) && (
                <div style={{
                  fontSize: 12, color: "#555", fontStyle: "italic", marginTop: 10,
                  borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 10,
                  fontFamily: "'Crimson Text', serif", lineHeight: 1.6,
                }}>
                  {currentFace.flavor_text || cd.flavor_text}
                </div>
              )}
            </div>
          )}

          {/* Power/Toughness or Loyalty */}
          {(currentFace.power || cd.loyalty) && (
            <div style={{ marginBottom: 16, display: "flex", gap: 10 }}>
              {currentFace.power && (
                <div style={{
                  padding: "4px 12px", background: "rgba(201,168,76,0.06)",
                  borderRadius: 6, border: "1px solid rgba(201,168,76,0.12)",
                  fontSize: 14, fontWeight: 700, color: "#c9a84c", fontFamily: "'Cinzel', serif",
                }}>
                  {currentFace.power}/{currentFace.toughness}
                </div>
              )}
              {cd.loyalty && (
                <div style={{
                  padding: "4px 12px", background: "rgba(77,163,212,0.06)",
                  borderRadius: 6, border: "1px solid rgba(77,163,212,0.12)",
                  fontSize: 14, fontWeight: 700, color: "#4DA3D4", fontFamily: "'Cinzel', serif",
                }}>
                  Loyalty: {cd.loyalty}
                </div>
              )}
            </div>
          )}

          {/* Pricing */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {price && (
              <div style={{
                padding: "6px 14px", background: "rgba(77,184,122,0.06)", borderRadius: 8,
                border: "1px solid rgba(77,184,122,0.1)",
              }}>
                <div style={{ fontSize: 8, color: "#4DB87A88", letterSpacing: 1, marginBottom: 2, fontFamily: "'Cinzel', serif" }}>USD</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#4DB87A", fontFamily: "'Cinzel', serif" }}>${price}</div>
              </div>
            )}
            {foilPrice && foilPrice !== price && (
              <div style={{
                padding: "6px 14px", background: "rgba(201,168,76,0.04)", borderRadius: 8,
                border: "1px solid rgba(201,168,76,0.08)",
              }}>
                <div style={{ fontSize: 8, color: "#c9a84c88", letterSpacing: 1, marginBottom: 2, fontFamily: "'Cinzel', serif" }}>FOIL</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#c9a84c", fontFamily: "'Cinzel', serif" }}>${foilPrice}</div>
              </div>
            )}
          </div>

          {/* Format Legality */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 8, color: "#55555588", letterSpacing: 2, marginBottom: 8, fontFamily: "'Cinzel', serif" }}>FORMAT LEGALITY</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {formatOrder.map(fmt => {
                const status = legalities[fmt] || "not_legal";
                return (
                  <div
                    key={fmt}
                    style={{
                      padding: "3px 8px", borderRadius: 5, fontSize: 9,
                      fontFamily: "'Cinzel', serif", letterSpacing: 0.5,
                      background: status === "legal" ? "rgba(77,184,122,0.08)" : status === "banned" ? "rgba(224,90,80,0.08)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${legalityColor(status)}33`,
                      color: legalityColor(status),
                    }}
                  >
                    {fmt.charAt(0).toUpperCase() + fmt.slice(1)}
                    <span style={{ marginLeft: 4, fontSize: 8 }}>
                      {status === "legal" ? "✓" : status === "banned" ? "✗" : status === "restricted" ? "!" : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scryfall link */}
          {cd.scryfall_uri && (
            <a
              href={cd.scryfall_uri}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 10, color: "#4DA3D4", textDecoration: "none",
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 10px", border: "1px solid #4DA3D422", borderRadius: 6,
                transition: "all 0.2s",
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = "#4DA3D444"; e.currentTarget.style.background = "rgba(77,163,212,0.04)"; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = "#4DA3D422"; e.currentTarget.style.background = "transparent"; }}
            >
              🔍 View on Scryfall →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

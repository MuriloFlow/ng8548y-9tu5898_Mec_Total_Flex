import type { Transition, Variants } from "framer-motion";

/**
 * Curvas e molas compartilhadas por toda a interface. Manter os valores em um
 * só lugar é o que faz telas diferentes parecerem parte do mesmo aplicativo:
 * qualquer ajuste de ritmo aqui se propaga para botões, listas, abas e sheets.
 */

/** Curva padrão do iOS para sheets e painéis — sai rápido e desacelera longo. */
export const EASE_IOS = [0.32, 0.72, 0, 1] as const;

/** Desaceleração forte, boa para entradas de conteúdo. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/** Simétrica e curta, para trocas de estado que não devem chamar atenção. */
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;

/** Reação imediata: pílulas de navegação, toggles, chips. */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.7,
};

/** Movimento com peso, para cartões e elementos maiores. */
export const springSmooth: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 28,
  mass: 0.9,
};

/** Usada quando o elemento cobre a tela e o exagero incomodaria. */
export const springGentle: Transition = {
  type: "spring",
  stiffness: 180,
  damping: 26,
  mass: 1,
};

/** Toque em cartão: encolhe o suficiente para dar retorno tátil sem "pular". */
export const pressScale = {
  whileTap: { scale: 0.975 },
  transition: springSnappy,
} as const;

/**
 * Entrada de conteúdo de tela. O deslocamento é pequeno de propósito — acima de
 * ~10px a animação passa a parecer um carregamento, não um refinamento.
 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: EASE_OUT_EXPO },
  },
};

/** Contêiner de lista: encadeia os filhos em cascata curta. */
export const staggerContainer: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.045, delayChildren: 0.02 },
  },
};

/** Item de lista em cascata. Pareado com `staggerContainer`. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.99 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.36, ease: EASE_OUT_EXPO },
  },
};

/** Escala suave para números e métricas que aparecem depois dos dados. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: springSmooth,
  },
};

/**
 * Transição entre telas. `direction` permite empilhar (avançar) e voltar como
 * um app nativo, em vez de todas as telas entrarem do mesmo lado.
 */
export function pageVariants(direction: 1 | -1 = 1): Variants {
  return {
    hidden: { opacity: 0, x: 12 * direction },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.28, ease: EASE_OUT_EXPO },
    },
    exit: {
      opacity: 0,
      x: -10 * direction,
      transition: { duration: 0.18, ease: EASE_IN_OUT },
    },
  };
}

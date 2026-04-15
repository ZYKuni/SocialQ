/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#fff8ea",
        ink: "#1f2937",
        qqBlue: "#12a4ff",
        qqSky: "#74d3ff",
        qqMint: "#8de7c8",
        qqGold: "#ffd66b",
        qqPeach: "#ffb69a",
      },
      boxShadow: {
        float: "0 20px 45px rgba(31, 41, 55, 0.18)",
      },
      fontFamily: {
        display: ['"Avenir Next"', '"Nunito"', '"Trebuchet MS"', "sans-serif"],
      },
      keyframes: {
        bob: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        bob: "bob 2.4s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
      },
    },
  },
  plugins: [],
};

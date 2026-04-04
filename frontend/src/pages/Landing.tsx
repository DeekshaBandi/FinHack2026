import { useNavigate } from "react-router-dom";

interface LandingProps {
  platformName: string;
}

function Landing({ platformName }: LandingProps) {
  const navigate = useNavigate();

  return (
    <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4">
      <h1 className="text-6xl md:text-8xl font-bold text-white tracking-tight mb-6 text-center drop-shadow-lg">
        {platformName}
      </h1>

      <p className="text-base md:text-xl text-white/60 font-light max-w-lg text-center mb-14 leading-relaxed">
        AI-Powered Climate Risk Intelligence for Hedge Funds
      </p>

      <button
        onClick={() => navigate("/dashboard")}
        className="px-8 py-3.5 rounded-xl text-sm font-semibold tracking-wide text-white
                   bg-white/[0.06] backdrop-blur-md border border-white/[0.12]
                   hover:bg-white/[0.12] hover:border-white/[0.2]
                   transition-all duration-300 cursor-pointer
                   shadow-[0_0_30px_rgba(255,255,255,0.04)]"
      >
        Enter Dashboard →
      </button>
    </div>
  );
}

export default Landing;

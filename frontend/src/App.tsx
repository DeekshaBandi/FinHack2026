import { BrowserRouter, Routes, Route } from "react-router-dom";
import MoltenCoreShader from "@/components/ui/molten-core-shader";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";

const PLATFORM_NAME = "ClimaRisk";

function App() {
  return (
    <BrowserRouter>
      {/* Shader persists across all routes — no remount on navigation */}
      <MoltenCoreShader />
      <Routes>
        <Route path="/" element={<Landing platformName={PLATFORM_NAME} />} />
        <Route path="/dashboard" element={<Dashboard platformName={PLATFORM_NAME} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

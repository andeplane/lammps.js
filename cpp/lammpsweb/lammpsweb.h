#pragma once

#include "lammps.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>

class LAMMPSWeb {
public:
  using pointer_type = std::intptr_t;

  enum class ScalarType : std::uint8_t {
    Float32,
    Float64,
    Int32,
    Int64,
  };

  struct BufferView {
    pointer_type ptr = 0;
    std::uint32_t length = 0;
    std::uint32_t components = 1;
    ScalarType type = ScalarType::Float32;

    [[nodiscard]] bool empty() const noexcept { return ptr == 0 || length == 0; }
    [[nodiscard]] std::uint32_t count() const noexcept {
      return components == 0 ? 0 : length / components;
    }
  };

  struct ParticleSnapshot {
    BufferView positions;
    BufferView ids;
    BufferView types;
    std::uint32_t count = 0;
  };

  struct BondSnapshot {
    BufferView first;
    BufferView second;
    std::uint32_t count = 0;
  };

  struct BoxSnapshot {
    BufferView matrix;
    BufferView origin;
    BufferView lengths;
  };

  LAMMPSWeb();
  ~LAMMPSWeb();

  void start();
  void stop();

  void advance(std::int32_t steps = 1, bool applyPre = false, bool applyPost = false);
  void runCommand(const std::string &command);
  void runScript(const std::string &script);
  void runFile(const std::string &path);
  void setAsyncStepCallback(emscripten::val callback, emscripten::val waiter);
  bool setAsyncStepFrequency(const std::string &fixId, std::int32_t every);

  [[nodiscard]] bool isReady() const noexcept;
  [[nodiscard]] bool getIsRunning() const noexcept;
  [[nodiscard]] double getCurrentStep() const noexcept;
  [[nodiscard]] double getTimestepSize() const noexcept;
  [[nodiscard]] double getComputeScalar(const std::string &id) const noexcept;

  ParticleSnapshot syncParticles();
  ParticleSnapshot syncParticlesWrapped();
  BondSnapshot syncBonds();
  BondSnapshot syncBondsWrapped();
  BoxSnapshot syncSimulationBox();

private:
  static void destroyLammps(LAMMPS_NS::LAMMPS *ptr) noexcept;
  using LammpsPtr = std::unique_ptr<LAMMPS_NS::LAMMPS, decltype(&LAMMPSWeb::destroyLammps)>;

  [[nodiscard]] bool hasSimulation() const noexcept { return static_cast<bool>(m_lmp); }
  [[nodiscard]] LAMMPS_NS::LAMMPS *raw() const noexcept { return m_lmp.get(); }
  void resetStaticBuffers() noexcept;
  ParticleSnapshot captureParticles(bool wrapped);
  BondSnapshot captureBonds(bool wrapped);

  template <typename Container>
  static pointer_type pointerFrom(Container &buffer) noexcept {
    using ValueType = typename Container::value_type;
    if (buffer.empty()) {
      return 0;
    }
    return reinterpret_cast<pointer_type>(buffer.data());
  }

  template <typename T, std::size_t N>
  static pointer_type pointerFrom(std::array<T, N> &buffer) noexcept {
    return reinterpret_cast<pointer_type>(buffer.data());
  }

  template <typename Container>
  static BufferView makeView(Container &buffer, std::uint32_t components, ScalarType type) noexcept {
    BufferView view{};
    view.ptr = pointerFrom(buffer);
    view.length = static_cast<std::uint32_t>(buffer.size());
    view.components = components;
    view.type = type;
    if (view.ptr == 0) {
      view.length = 0;
      view.components = 0;
    }
    return view;
  }

  static BufferView makeRawView(void *ptr, std::uint32_t count, std::uint32_t components, ScalarType type) noexcept {
    BufferView view{};
    if (!ptr || count == 0 || components == 0) {
      return view;
    }
    view.ptr = reinterpret_cast<pointer_type>(ptr);
    view.length = count * components;
    view.components = components;
    view.type = type;
    return view;
  }

  LammpsPtr m_lmp{nullptr, &LAMMPSWeb::destroyLammps};
  std::array<float, 9> m_cellMatrix{};
  std::array<float, 3> m_boxSize{};
  std::array<float, 3> m_origo{};
  std::vector<float> m_particlePositions;
  std::vector<float> m_bondsPosition1;
  std::vector<float> m_bondsPosition2;
};

namespace LAMMPSWebAsync {
void setStepCallback(emscripten::val callback);
void setPromiseWaiter(emscripten::val waiter);
bool invokeStepCallbackAndWait(std::int32_t step);
}  // namespace LAMMPSWebAsync

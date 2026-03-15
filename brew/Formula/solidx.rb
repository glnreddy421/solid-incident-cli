class Solidx < Formula
  desc "SOLID CLI-first incident investigation tool"
  homepage "https://github.com/glnreddy421/solid-incident-cli"
  license "MIT"
  version "0.1.1"
  depends_on "node"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/glnreddy421/solid-incident-cli/releases/download/v#{version}/solidx-v#{version}-darwin-arm64.tar.gz"
      sha256 "REPLACE_DARWIN_ARM64_SHA256"
    else
      url "https://github.com/glnreddy421/solid-incident-cli/releases/download/v#{version}/solidx-v#{version}-darwin-x64.tar.gz"
      sha256 "REPLACE_DARWIN_X64_SHA256"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/glnreddy421/solid-incident-cli/releases/download/v#{version}/solidx-v#{version}-linux-arm64.tar.gz"
      sha256 "REPLACE_LINUX_ARM64_SHA256"
    else
      url "https://github.com/glnreddy421/solid-incident-cli/releases/download/v#{version}/solidx-v#{version}-linux-x64.tar.gz"
      sha256 "REPLACE_LINUX_X64_SHA256"
    end
  end

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"solidx"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/solidx --version")
  end
end


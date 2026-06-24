type Variant = "green" | "blue" | "gray" | "orange";

const styles: Record<Variant, string> = {
  green: "bg-[#E6F9EE] text-[#05A847] border-[#B3EDD0]",
  blue: "bg-[#EEF2FF] text-[#4F46E5] border-[#C7D2FE]",
  gray: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]",
  orange: "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]",
};

export default function Badge({
  children,
  variant = "gray",
}: {
  children: React.ReactNode;
  variant?: Variant;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

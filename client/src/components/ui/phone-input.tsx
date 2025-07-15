import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function PhoneInput({ value, onChange, placeholder, className }: PhoneInputProps) {
  const [formattedValue, setFormattedValue] = useState(value);

  useEffect(() => {
    setFormattedValue(value);
  }, [value]);

  const formatPhoneNumber = (input: string) => {
    // Remove all non-digit characters
    const digits = input.replace(/\D/g, '');
    
    if (digits.length === 0) return '';
    
    // Format based on length
    if (digits.length <= 3) {
      return `+1 (${digits}`;
    } else if (digits.length <= 6) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4)}`;
    } else {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    
    // Extract digits for the actual value
    const digits = input.replace(/\D/g, '');
    
    // Format for display
    const formatted = formatPhoneNumber(input);
    setFormattedValue(formatted);
    
    // Pass back the full phone number with country code
    if (digits.length > 0) {
      onChange(`+1${digits.slice(1)}`);
    } else {
      onChange('');
    }
  };

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Phone className="h-4 w-4 text-gray-400" />
      </div>
      <Input
        type="tel"
        value={formattedValue}
        onChange={handleChange}
        placeholder={placeholder}
        className={cn("pl-10", className)}
        maxLength={18}
      />
    </div>
  );
}

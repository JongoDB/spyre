export interface Persona {
  id: string;
  name: string;
  role: string;
  avatar: string;
  description: string | null;
  instructions: string;
  default_model: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonaInput {
  name: string;
  role: string;
  avatar?: string;
  description?: string | null;
  instructions?: string;
  default_model?: string;
}

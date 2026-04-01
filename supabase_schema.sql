-- TimeGlobe Supabase Database Schema
-- Execute this script in Supabase SQL Editor to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types
CREATE TYPE appointment_status AS ENUM ('booked', 'cancelled', 'completed');
CREATE TYPE waba_status AS ENUM ('pending', 'connected', 'failed');

-- ============================================================================
-- BUSINESSES TABLE
-- ============================================================================
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Business information fields
    tax_id VARCHAR(50),
    street_address VARCHAR(255),
    postal_code VARCHAR(20),
    city VARCHAR(100),
    country VARCHAR(100),
    contact_person VARCHAR(255),
    
    -- 360dialog WhatsApp Business API fields
    client_id VARCHAR(255),
    channel_id VARCHAR(255),
    api_key VARCHAR(255),
    api_endpoint VARCHAR(255),
    app_id VARCHAR(255),
    waba_status waba_status DEFAULT 'pending',
    whatsapp_profile JSONB,
    whatsapp_number VARCHAR(50),
    
    -- TimeGlobe-specific fields
    timeglobe_auth_key VARCHAR(255),
    customer_cd VARCHAR(255)
);

-- Indexes for businesses
CREATE INDEX idx_businesses_email ON businesses(email);
CREATE INDEX idx_businesses_is_active ON businesses(is_active);
CREATE INDEX idx_businesses_whatsapp_number ON businesses(whatsapp_number);

-- ============================================================================
-- SUBSCRIPTION PLANS TABLE
-- ============================================================================
CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    duration_days INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true
);

-- ============================================================================
-- BUSINESS SUBSCRIPTIONS TABLE
-- ============================================================================
CREATE TABLE business_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    subscription_plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_date TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true
);

-- Indexes for business_subscriptions
CREATE INDEX idx_business_subscriptions_business_id ON business_subscriptions(business_id);
CREATE INDEX idx_business_subscriptions_is_active ON business_subscriptions(is_active);

-- ============================================================================
-- CUSTOMERS TABLE
-- ============================================================================
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    mobile_number VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255),
    gender VARCHAR(10),
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
    dplAccepted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for customers
CREATE INDEX idx_customers_mobile_number ON customers(mobile_number);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_business_id ON customers(business_id);
CREATE INDEX idx_customers_created_at ON customers(created_at);
CREATE INDEX idx_customers_mobile_business ON customers(mobile_number, business_id);
CREATE INDEX idx_customers_email_business ON customers(email, business_id);
CREATE INDEX idx_customers_created_business ON customers(created_at, business_id);
CREATE INDEX idx_customers_dpl_business ON customers(dplAccepted, business_id);

-- ============================================================================
-- BOOKED APPOINTMENTS TABLE
-- ============================================================================
CREATE TABLE booked_appointments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER UNIQUE,
    site_cd VARCHAR(255) NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    customer_phone VARCHAR(50),
    business_phone_number VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status appointment_status DEFAULT 'booked',
    cancelled_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for booked_appointments
CREATE INDEX idx_booked_appointments_order_id ON booked_appointments(order_id);
CREATE INDEX idx_booked_appointments_customer_id ON booked_appointments(customer_id);
CREATE INDEX idx_booked_appointments_customer_phone ON booked_appointments(customer_phone);
CREATE INDEX idx_booked_appointments_business_phone ON booked_appointments(business_phone_number);
CREATE INDEX idx_booked_appointments_created_at ON booked_appointments(created_at);
CREATE INDEX idx_appointment_business_date ON booked_appointments(business_phone_number, created_at);
CREATE INDEX idx_appointment_customer_date ON booked_appointments(customer_id, created_at);
CREATE INDEX idx_appointment_customer_phone_date ON booked_appointments(customer_phone, created_at);
CREATE INDEX idx_appointment_cancelled_date ON booked_appointments(business_phone_number, cancelled_at);

-- ============================================================================
-- BOOKING DETAILS TABLE
-- ============================================================================
CREATE TABLE booking_details (
    id SERIAL PRIMARY KEY,
    begin_ts TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_millis BIGINT NOT NULL,
    employee_id INTEGER,
    item_no INTEGER,
    item_nm VARCHAR(255),
    book_id INTEGER NOT NULL REFERENCES booked_appointments(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for booking_details
CREATE INDEX idx_booking_details_book_id ON booking_details(book_id);
CREATE INDEX idx_booking_details_begin_ts ON booking_details(begin_ts);

-- ============================================================================
-- CONVERSATION HISTORY TABLE
-- ============================================================================
CREATE TABLE conversation_history (
    id SERIAL PRIMARY KEY,
    mobile_number VARCHAR(25) NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for conversation_history
CREATE INDEX idx_conversation_history_mobile_number ON conversation_history(mobile_number);
CREATE INDEX idx_conversation_history_created_at ON conversation_history(created_at);
CREATE INDEX idx_conversation_history_updated_at ON conversation_history(updated_at);
CREATE INDEX idx_conversation_mobile_created ON conversation_history(mobile_number, created_at);
CREATE INDEX idx_conversation_updated_created ON conversation_history(updated_at, created_at);

-- ============================================================================
-- MAIN CONTRACTS TABLE
-- ============================================================================
CREATE TABLE main_contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    contract_text TEXT NOT NULL,
    signature_image TEXT, -- Store base64 signature image
    signature_image_path VARCHAR(500), -- Path to signature image if stored separately
    pdf_file BYTEA, -- Store the PDF as binary data
    file_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for main_contracts
CREATE INDEX idx_main_contracts_business_id ON main_contracts(business_id);

-- ============================================================================
-- AUFTRAGSVERARBEITUNG CONTRACTS TABLE
-- ============================================================================
CREATE TABLE auftragsverarbeitung_contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    contract_text TEXT NOT NULL,
    signature_image TEXT, -- Store base64 signature image
    pdf_file BYTEA, -- Store the PDF as binary data
    file_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for auftragsverarbeitung_contracts
CREATE INDEX idx_auftragsverarbeitung_contracts_business_id ON auftragsverarbeitung_contracts(business_id);

-- ============================================================================
-- LASTSCHRIFTMANDAT TABLE
-- ============================================================================
CREATE TABLE lastschriftmandats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    pdf_file BYTEA NOT NULL, -- Store the PDF directly
    file_name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for lastschriftmandats
CREATE INDEX idx_lastschriftmandats_business_id ON lastschriftmandats(business_id);

-- ============================================================================
-- RESET TOKENS TABLE
-- ============================================================================
CREATE TABLE reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token VARCHAR(255) UNIQUE NOT NULL,
    business_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for reset_tokens
CREATE INDEX idx_reset_tokens_token ON reset_tokens(token);
CREATE INDEX idx_reset_tokens_business_id ON reset_tokens(business_id);
CREATE INDEX idx_reset_token_business_expires ON reset_tokens(business_id, expires_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE booked_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE main_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auftragsverarbeitung_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lastschriftmandats ENABLE ROW LEVEL SECURITY;
ALTER TABLE reset_tokens ENABLE ROW LEVEL SECURITY;

-- Create policies for businesses (users can only access their own business)
CREATE POLICY "Users can view own business" ON businesses FOR SELECT USING (auth.uid()::text = id::text);
CREATE POLICY "Users can update own business" ON businesses FOR UPDATE USING (auth.uid()::text = id::text);
CREATE POLICY "Users can insert own business" ON businesses FOR INSERT WITH CHECK (auth.uid()::text = id::text);

-- Create policies for customers (business can access their customers)
CREATE POLICY "Business can view own customers" ON customers FOR SELECT USING (
    business_id IN (SELECT id FROM businesses WHERE id::text = auth.uid()::text)
);
CREATE POLICY "Business can insert own customers" ON customers FOR INSERT WITH CHECK (
    business_id IN (SELECT id FROM businesses WHERE id::text = auth.uid()::text)
);
CREATE POLICY "Business can update own customers" ON customers FOR UPDATE USING (
    business_id IN (SELECT id FROM businesses WHERE id::text = auth.uid()::text)
);

-- Create policies for booked_appointments
CREATE POLICY "Business can view own appointments" ON booked_appointments FOR SELECT USING (
    business_phone_number IN (SELECT whatsapp_number FROM businesses WHERE id::text = auth.uid()::text)
);
CREATE POLICY "Business can insert own appointments" ON booked_appointments FOR INSERT WITH CHECK (
    business_phone_number IN (SELECT whatsapp_number FROM businesses WHERE id::text = auth.uid()::text)
);
CREATE POLICY "Business can update own appointments" ON booked_appointments FOR UPDATE USING (
    business_phone_number IN (SELECT whatsapp_number FROM businesses WHERE id::text = auth.uid()::text)
);

-- Create policies for booking_details
CREATE POLICY "Business can view own booking details" ON booking_details FOR SELECT USING (
    book_id IN (
        SELECT ba.id FROM booked_appointments ba 
        JOIN businesses b ON ba.business_phone_number = b.whatsapp_number 
        WHERE b.id::text = auth.uid()::text
    )
);
CREATE POLICY "Business can insert own booking details" ON booking_details FOR INSERT WITH CHECK (
    book_id IN (
        SELECT ba.id FROM booked_appointments ba 
        JOIN businesses b ON ba.business_phone_number = b.whatsapp_number 
        WHERE b.id::text = auth.uid()::text
    )
);
CREATE POLICY "Business can update own booking details" ON booking_details FOR UPDATE USING (
    book_id IN (
        SELECT ba.id FROM booked_appointments ba 
        JOIN businesses b ON ba.business_phone_number = b.whatsapp_number 
        WHERE b.id::text = auth.uid()::text
    )
);

-- Create policies for conversation_history
CREATE POLICY "Business can view own conversations" ON conversation_history FOR SELECT USING (
    mobile_number IN (
        SELECT DISTINCT c.mobile_number FROM customers c 
        JOIN businesses b ON c.business_id = b.id 
        WHERE b.id::text = auth.uid()::text
    )
);
CREATE POLICY "Business can insert own conversations" ON conversation_history FOR INSERT WITH CHECK (
    mobile_number IN (
        SELECT DISTINCT c.mobile_number FROM customers c 
        JOIN businesses b ON c.business_id = b.id 
        WHERE b.id::text = auth.uid()::text
    )
);
CREATE POLICY "Business can update own conversations" ON conversation_history FOR UPDATE USING (
    mobile_number IN (
        SELECT DISTINCT c.mobile_number FROM customers c 
        JOIN businesses b ON c.business_id = b.id 
        WHERE b.id::text = auth.uid()::text
    )
);

-- Create policies for contracts and documents
CREATE POLICY "Business can view own main contracts" ON main_contracts FOR SELECT USING (business_id::text = auth.uid()::text);
CREATE POLICY "Business can insert own main contracts" ON main_contracts FOR INSERT WITH CHECK (business_id::text = auth.uid()::text);
CREATE POLICY "Business can update own main contracts" ON main_contracts FOR UPDATE USING (business_id::text = auth.uid()::text);

CREATE POLICY "Business can view own auftragsverarbeitung contracts" ON auftragsverarbeitung_contracts FOR SELECT USING (business_id::text = auth.uid()::text);
CREATE POLICY "Business can insert own auftragsverarbeitung contracts" ON auftragsverarbeitung_contracts FOR INSERT WITH CHECK (business_id::text = auth.uid()::text);
CREATE POLICY "Business can update own auftragsverarbeitung contracts" ON auftragsverarbeitung_contracts FOR UPDATE USING (business_id::text = auth.uid()::text);

CREATE POLICY "Business can view own lastschriftmandats" ON lastschriftmandats FOR SELECT USING (business_id::text = auth.uid()::text);
CREATE POLICY "Business can insert own lastschriftmandats" ON lastschriftmandats FOR INSERT WITH CHECK (business_id::text = auth.uid()::text);
CREATE POLICY "Business can update own lastschriftmandats" ON lastschriftmandats FOR UPDATE USING (business_id::text = auth.uid()::text);

-- Create policies for business_subscriptions
CREATE POLICY "Business can view own subscriptions" ON business_subscriptions FOR SELECT USING (business_id::text = auth.uid()::text);
CREATE POLICY "Business can insert own subscriptions" ON business_subscriptions FOR INSERT WITH CHECK (business_id::text = auth.uid()::text);
CREATE POLICY "Business can update own subscriptions" ON business_subscriptions FOR UPDATE USING (business_id::text = auth.uid()::text);

-- Create policies for reset_tokens
CREATE POLICY "Business can view own reset tokens" ON reset_tokens FOR SELECT USING (business_id::text = auth.uid()::text);
CREATE POLICY "Business can insert own reset tokens" ON reset_tokens FOR INSERT WITH CHECK (business_id::text = auth.uid()::text);
CREATE POLICY "Business can update own reset tokens" ON reset_tokens FOR UPDATE USING (business_id::text = auth.uid()::text);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_main_contracts_updated_at BEFORE UPDATE ON main_contracts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_auftragsverarbeitung_contracts_updated_at BEFORE UPDATE ON auftragsverarbeitung_contracts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lastschriftmandats_updated_at BEFORE UPDATE ON lastschriftmandats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_conversation_history_updated_at BEFORE UPDATE ON conversation_history FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================================================

-- Insert sample subscription plans
INSERT INTO subscription_plans (id, name, description, price, duration_days, is_active) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Basic Plan', 'Basic subscription plan', 29.99, 30, true),
('550e8400-e29b-41d4-a716-446655440001', 'Pro Plan', 'Professional subscription plan', 59.99, 30, true),
('550e8400-e29b-41d4-a716-446655440002', 'Enterprise Plan', 'Enterprise subscription plan', 99.99, 30, true);

-- ============================================================================
-- GRANTS AND PERMISSIONS
-- ============================================================================

-- Grant necessary permissions to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Grant permissions to anon users for specific operations (if needed)
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON subscription_plans TO anon; -- Allow anonymous users to view subscription plans

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

-- This schema is now ready for use with TimeGlobe application
-- All tables, indexes, RLS policies, and triggers have been created
-- You can now configure your application to use Supabase instead of SQLite

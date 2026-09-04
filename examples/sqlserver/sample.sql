--
-- Microsoft SQL Server database script
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

USE [ShopDb]
GO

CREATE SCHEMA [sales]
GO

CREATE TABLE [sales].[customers](
    [id] [int] IDENTITY(1,1) NOT NULL,
    [name] [nvarchar](100) NOT NULL,
    [note] [nvarchar](max) NULL,
    [ref] [uniqueidentifier] NULL,
    [active] [bit] NOT NULL,
    [thumbnail] [varbinary](max) NULL,
 CONSTRAINT [PK_customers] PRIMARY KEY CLUSTERED ([id] ASC)
)
GO

SET IDENTITY_INSERT [sales].[customers] ON
GO

INSERT [sales].[customers] ([id], [name], [note], [ref], [active], [thumbnail]) VALUES
(1, N'Alice Example', N'says ''hi''', NULL, 1, 0x0102FF),
(2, N'Bob Example', N'first line
GO
second line', NULL, 0, NULL)
GO

INSERT INTO [sales].[customers] ([id], [name], [note], [ref], [active], [thumbnail]) VALUES (3, N'Zoë Müller', NULL, NULL, 1, NULL)
GO

SET IDENTITY_INSERT [sales].[customers] OFF
GO

ALTER TABLE [sales].[customers] ADD CONSTRAINT [DF_active] DEFAULT ((1)) FOR [active]
GO

CREATE TABLE [orders](
    [id] [int] IDENTITY(1,1) NOT NULL,
    [customer_id] [int] NOT NULL,
    [note] [nvarchar](200) NULL,
    [total] [decimal](10, 2) NOT NULL,
 CONSTRAINT [PK_orders] PRIMARY KEY CLUSTERED ([id] ASC)
)
GO

INSERT INTO [dbo].[orders] ([id], [customer_id], [note], [total]) VALUES
(1, 1, N'Includes tax; ships free', 19.99),
(2, 3, NULL, 42.50)
GO

CREATE INDEX [IX_orders_customer] ON [dbo].[orders] ([customer_id])
GO

CREATE TABLE [sales].[Order Items](
    [id] [int] NOT NULL,
    [item_name] [nvarchar](100) NOT NULL,
 CONSTRAINT [PK_Order_Items] PRIMARY KEY CLUSTERED ([id] ASC)
)
GO

INSERT [sales].[Order Items] ([id], [item_name]) VALUES (1, N'Widget')
GO

CREATE TABLE [empty_table](
    [id] [int] NOT NULL
)
GO

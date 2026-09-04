-- Azure Synapse Analytics (dedicated SQL pool) script
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- A Synapse table is T-SQL plus a WITH clause saying how rows are spread
-- across the distributions and how they are stored.

USE [warehouse]
GO

CREATE SCHEMA [mart]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [mart].[sales](
	[id] [int] NOT NULL,
	[customer] [nvarchar](120) NOT NULL,
	[amount] [decimal](12, 2) NULL,
	[note] [nvarchar](max) NULL
)
WITH
(
	DISTRIBUTION = HASH([id]),
	CLUSTERED COLUMNSTORE INDEX
)
GO

INSERT [mart].[sales] ([id], [customer], [amount], [note]) VALUES (1, N'Alice Example', 129.50, N'Paid; invoice A-100')
INSERT [mart].[sales] ([id], [customer], [amount], [note]) VALUES (2, N'Bob Example', NULL, NULL)
INSERT [mart].[sales] ([id], [customer], [amount], [note]) VALUES (3, N'Zoë Example', 44.00, N'São Paulo depot')
GO

CREATE TABLE [mart].[regions](
	[id] [int] NOT NULL,
	[name] [nvarchar](60) NOT NULL
)
WITH
(
	DISTRIBUTION = REPLICATE,
	CLUSTERED COLUMNSTORE INDEX
)
GO

INSERT [mart].[regions] ([id], [name]) VALUES (1, N'North')
INSERT [mart].[regions] ([id], [name]) VALUES (2, N'South')
GO
